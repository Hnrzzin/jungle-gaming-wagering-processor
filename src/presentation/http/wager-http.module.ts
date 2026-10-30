import {
  type DynamicModule,
  Module,
  type Provider,
} from "@nestjs/common";
import {
  HEALTH_CHECKS,
} from "../../application/tokens";
import {
  defaultProcessWagerProviders,
} from "../../application/services/process-wager.provider";
import type {
  HealthCheck,
} from "./health.controller";
import { HealthController } from "./health.controller";
import { HttpErrorFilter } from "./http-error.filter";
import { WagerController } from "./wager.controller";

export interface WagerHttpModuleOptions {
  readonly healthChecks?: HealthCheck[];
  readonly extraProviders?: Provider[];
}

@Module({})
export class WagerHttpModule {
  static register(options: WagerHttpModuleOptions = {}): DynamicModule {
    return {
      module: WagerHttpModule,
      controllers: [
        WagerController,
        HealthController,
      ],
      providers: [
        {
          provide: HEALTH_CHECKS,
          useValue: options.healthChecks ?? [],
        },
        ...defaultProcessWagerProviders,
        ...(options.extraProviders ?? []),
        HttpErrorFilter,
      ],
      exports: [],
    };
  }
}