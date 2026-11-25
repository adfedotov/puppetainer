# Puppetainer

A personal learning project: a **Firecracker microVM sandbox for AI agents**. The agent's
"brain" (the LLM loop) runs on the host. Its "hands" (shell commands, file edits) run inside an
isolated microVM, steered over **virtio-vsock**.

It's a small, single-host take on the core of Google Cloud's **Agent Compute Engine**, as
described in
[Agent Compute Engine deep dive](https://cloud.google.com/blog/topics/ai-infrastructure/agent-compute-engine-deep-dive).
It's also in the spirit of [E2B](https://github.com/e2b-dev/infra). The
point is to understand each building block by building it, and to make the design decisions
myself.

## What I'm trying to recreate (and what I'm not)

From the ACE design I'm taking the **sandbox core**:

| ACE idea | Puppetainer version |
|---|---|
| Hardware-isolated microVM per agent session | Firecracker microVM per session, inside the `jailer` |
| Harness (brain) outside, sandbox (hands) inside | TypeScript harness + controller on the host, small guest agent in the VM |
| virtio-vsock as the boundary between host and sandbox | All control traffic (exec, files, status) over vsock |
| Sandbox runs only commands sent by the harness, streams output back | Guest agent `exec` RPC with streamed stdout/stderr |
| Read-only shared images + scratch + persistent workspace | Shared read-only rootfs + tmpfs scratch + per-session workspace disk |
| Snapshot / rewind / rollback | Copy-on-write (reflink) workspace checkpoint at the start of every agent turn, at the block level so it captures *all* shell side effects; rollback is triggered by the user/harness || Application-aware idle detection, checkpoint to zero resources | Controller knows when no command is in flight, then pauses, then snapshots and stops the VM; restores on the next command |
| No secrets in the guest | API keys live only on the host, in the harness |

**Out of scope:** everything Google-scale or hardware-specific. That covers multi-host
scheduling, Titan/IPU attestation, the four-identity model, Agent Gateway / Private Service
Connect, Hyperdisk, and fleet-wide memory dedup.

**Deliberate difference (for now):** ACE gives microVMs **no network card** and sends all egress
over vsock to a policy proxy. Puppetainer starts with a normal **TAP device + NAT** with egress
filtering, to keep things moving. vsock-only egress is a planned later milestone.

## The final product

A host service plus harness where:

1. `puppetainer run --prompt "..."` starts (or resumes) a **session**, a dedicated microVM with
   its own workspace disk.
2. The agent loop on the host calls tools (`run_command`, `read_file`, `write_file`), which are
   sent over vsock to the guest agent and executed in the VM.
3. At the start of every turn the workspace is **checkpointed**. The user can rewind a session to
   any earlier turn (`puppetainer rollback <session> <turn>`), undoing everything the agent did,
   including side effects of shell commands, which file-edit-level undo in typical harnesses
   doesn't cover.
4. The VM has internet access, but can't reach the host, the LAN, or link-local and metadata
   addresses.
5. While the agent waits (for the model or for the user), the VM is **paused**. After a longer
   idle period it's **hibernated** (memory snapshot on disk, process gone). It wakes up
   transparently on the next tool call.

## Requirements

- Linux x86_64 with KVM (`/dev/kvm`)
- Firecracker + jailer **v1.18.0** (pinned: snapshots only restore on the same version)
- A host filesystem with reflink support (btrfs or XFS) for cheap checkpoints
- Node.js (harness/controller), Go (guest agent), `iproute2`, `nftables`

## Sources and further reading

**The design this is modeled on**
- Google Cloud: [Agent Compute Engine deep dive](https://cloud.google.com/blog/topics/ai-infrastructure/agent-compute-engine-deep-dive)
- [E2B infrastructure](https://github.com/e2b-dev/infra): open-source agent sandboxes on Firecracker

**Firecracker**
- [Firecracker](https://github.com/firecracker-microvm/firecracker) and its `docs/`:
  `getting-started.md`, `vsock.md`, `network-setup.md`, `jailer.md`, `prod-host-setup.md`,
  `snapshotting/`, `ballooning.md`
- Paper: *Firecracker: Lightweight Virtualization for Serverless Applications*, NSDI 2020,
  [usenix.org](https://www.usenix.org/conference/nsdi20/presentation/agache)
- Paper: *Restoring Uniqueness in MicroVM Snapshots* (Brooker et al., 2021),
  [arXiv:2102.12892](https://arxiv.org/abs/2102.12892)
- Paper: *On-demand Container Loading in AWS Lambda*, USENIX ATC 2023,
  [usenix.org](https://www.usenix.org/conference/atc23/presentation/brooker)

**Similar designs worth reading**
- [Kata Containers agent](https://github.com/kata-containers/kata-containers/tree/main/src/agent):
  a guest agent controlled over vsock
- [firecracker-go-sdk](https://github.com/firecracker-microvm/firecracker-go-sdk),
  [firecracker-containerd](https://github.com/firecracker-microvm/firecracker-containerd)
- [gVisor](https://gvisor.dev/docs/): the user-space-kernel alternative (used in stage 0)

**Fundamentals**
- LWN: [Using the KVM API](https://lwn.net/Articles/658511/)
- LWN: [Namespaces in operation](https://lwn.net/Articles/531114/)
- [cgroup v2 kernel docs](https://docs.kernel.org/admin-guide/cgroup-v2.html), `man 7 vsock`,
  `man 2 seccomp`, `man 8 fsfreeze`
- [virtio specification (OASIS)](https://docs.oasis-open.org/virtio/virtio/)
- [nftables wiki](https://wiki.nftables.org/)
- Anthropic: [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
