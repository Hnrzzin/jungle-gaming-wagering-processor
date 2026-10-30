import { randomUUID } from "node:crypto";
import type { ProcessWagerIdGenerator } from "../use-cases/process-wager";

export class UuidIdGenerator implements ProcessWagerIdGenerator {
  generate(): string {
    return randomUUID();
  }
}