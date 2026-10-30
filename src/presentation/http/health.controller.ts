import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HEALTH_CHECKS } from "../../application/tokens";

export interface HealthCheck {
  readonly name: string;
  check(): Promise<void>;
}

@Controller("health")
export class HealthController {
  constructor(
    @Optional()
    @Inject(HEALTH_CHECKS)
    private readonly checks: HealthCheck[] = [],
  ) {}

  @Get()
  async health() {
    await this.verifyDependencies();

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      dependencies: this.checks.map((check) => ({
        name: check.name,
        status: "ok",
      })),
    };
  }

  @Get("live")
  live() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  async ready() {
    await this.verifyDependencies();

    return {
      status: "ready",
      timestamp: new Date().toISOString(),
    };
  }

  private async verifyDependencies(): Promise<void> {
    const results = await Promise.allSettled(
      this.checks.map((check) => check.check()),
    );

    const failed = results
      .map((result, index) => ({
        result,
        check: this.checks[index],
      }))
      .filter(
        (item) => item.result.status === "rejected",
      );

    if (failed.length > 0) {
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: "DEPENDENCY_UNAVAILABLE",
        message: "One or more dependencies are unavailable",
        dependencies: failed.map(({ check }) => ({
          name: check?.name ?? "unknown",
          status: "error",
        })),
      });
    }
  }
}