// Build-time stand-in for the optional `just-bash` peer of agents/skills/runner (21 MB). NPC agents
// declare no skills, so the shell runner is never constructed; failing loudly beats bundling it.
export class Bash {
  constructor() {
    throw new Error("just-bash is not bundled: NPC agents do not run skill scripts");
  }
}
export function defineCommand(): never {
  throw new Error("just-bash is not bundled: NPC agents do not run skill scripts");
}
