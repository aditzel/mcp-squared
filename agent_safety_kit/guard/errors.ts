import type { GuardDecision } from "./guard.js";

export class PolicyDenied extends Error {
  readonly decision: GuardDecision;

  constructor(message: string, decision: GuardDecision) {
    super(message);
    this.name = "PolicyDenied";
    this.decision = decision;
  }
}
