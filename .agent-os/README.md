# agent-os - drop-in bundle

Extract at the root of any project. You get one folder, `.agent-os/`, and nothing else.

    python .agent-os/scripts/install.py

That detects the harness and wires the strongest adapter it supports, then tells you what it did.

## What this gives the project

A **stage**, and a context layer that loads only that stage. The project declares its own stage in
a state file (`.agent-os/STATE.md` or `PROJECT-STATE.md`):

    STAGE: 0
    enforcement: deny      # deny | warn | off

No state file means nothing is enforced. Not a default of stage 0 - nothing. Create one with:

    python .agent-os/scripts/agent_os.py init

## What is portable and what is not

The content (`layers/`) and the CLI (`scripts/agent_os.py`) are plain markdown and dependency-free
python. They run under any harness, or none.

Enforcement is different, because a gate needs the harness to ask permission before it writes:

| harness | what you get |
|---|---|
| Claude Code | REAL. Hooks deny a stage-forbidden edit before it happens, inject the stage context at session start, and block a stage-advance claim the state file never recorded. |
| Codex CLI | ADVISORY. Context is rendered into `AGENTS.md`, which Codex reads. It has no pre-write hook, so the stage instructs rather than stops. |
| opencode | ADVISORY, same mechanism. |
| git | REAL, and harness-independent. A pre-commit hook runs the gate over staged files and refuses the commit. This is the backstop for the advisory cases. |

Install the git backstop alongside an advisory harness and you get enforcement even when the agent
ignores its instructions:

    python .agent-os/scripts/install.py --harness codex git

## Commands

    agent_os.py context            print the current stage's context (any harness, no hooks)
    agent_os.py check <path>...    the gate as a command - exit 1 if the stage forbids a path
    agent_os.py stage              what stage is this project in
    agent_os.py stage 1            advance it
    agent_os.py init               write a state file

After changing the stage, re-render the advisory blocks:

    python .agent-os/scripts/install.py --refresh

## The stages

| # | stage | ends when |
|---|---|---|
| 0 | SHAPE | every open decision is answered in writing |
| 1 | DESIGN DIRECTION | a winner picked from rendered options, written down as tokens |
| 2 | SYSTEM DESIGN | the plan exists, is read, and is sliced with verifiable exits |
| 3 | BUILD | every slice closed and verified as it landed |
| 4 | HARDEN | the demo-ware list is clean and there is a rollback path |
| 5 | LAUNCH AND ITERATE | verified live, watched, next slice chosen deliberately |

Stages 0 to 2 deny writes to `src/`, migrations and framework config; 3 to 5 deny nothing, because
by then sequencing is the plan's job. The rules are data, in `layers/stages.json` - edit them for
a project whose sequence differs.
