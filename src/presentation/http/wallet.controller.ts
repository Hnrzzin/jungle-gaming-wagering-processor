import {
  BadRequestException,
  ConflictException,
  Controller,
  Inject,
  Post,
  Body,
  Headers,
  UnauthorizedException,
} from "@nestjs/common";
import { CREATE_WALLET } from "../../application/tokens";
import {
  CreateWallet,
} from "../../application/use-cases/create-wallet";
import { Money } from "../../domain/money";
import { timingSafeEqual } from "node:crypto";

interface CreateWalletRequest {
  readonly playerId: unknown;
  readonly initialBalance: unknown;
  readonly currency: unknown;
}

@Controller("wallets")
export class WalletController {
  constructor(
    @Inject(CREATE_WALLET)
    private readonly createWallet: CreateWallet,
  ) {}

  @Post()
  async create(
    @Headers("x-wallet-provisioning-token") providedToken: string | undefined,
    @Body() body: CreateWalletRequest,
  ) {
    const configuredToken = process.env.WALLET_PROVISIONING_TOKEN;
    const expected = Buffer.from(configuredToken ?? "");
    const provided = Buffer.from(providedToken ?? "");
    const authorized =
      expected.length > 0 &&
      expected.length === provided.length &&
      timingSafeEqual(expected, provided);

    if (!authorized) {
      throw new UnauthorizedException({
        code: "WALLET_PROVISIONING_UNAUTHORIZED",
        message: "A valid wallet provisioning token is required",
      });
    }

    if (typeof body !== "object" || body === null) {
      throw new BadRequestException({
        code: "INVALID_REQUEST",
        message: "request body must be a JSON object",
      });
    }

    if (
      typeof body.playerId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.playerId)
    ) {
      throw new BadRequestException({
        code: "INVALID_PLAYER_ID",
        message: "playerId must be a valid UUID",
      });
    }

    if (
      typeof body.initialBalance !== "string" ||
      !/^\d{1,17}\.\d{2}$/.test(body.initialBalance)
    ) {
      throw new BadRequestException({
        code: "INVALID_INITIAL_BALANCE",
        message: "initialBalance must use the decimal format 0.00",
      });
    }

    if (
      typeof body.currency !== "string" ||
      !/^[A-Z]{3}$/.test(body.currency)
    ) {
      throw new BadRequestException({
        code: "INVALID_CURRENCY",
        message: "currency must be an ISO 4217 uppercase code",
      });
    }

    const initialBalance = Money.from({
      amount: body.initialBalance,
      currency: body.currency,
    });

    try {
      const wallet = await this.createWallet.execute({
        playerId: body.playerId,
        initialBalance,
      });

      return {
        walletId: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balance: wallet.balance.toString(),
        version: wallet.version,
        createdAt: wallet.createdAt.toISOString(),
      };
    } catch (error) {
      const candidate = error as {
        code?: unknown;
        cause?: { code?: unknown };
      };

      if (
        candidate?.code === "23505" ||
        candidate?.cause?.code === "23505"
      ) {
        throw new ConflictException({
          code: "WALLET_ALREADY_EXISTS",
          message: "A wallet already exists for this player and currency",
        });
      }

      throw error;
    }
  }
}
