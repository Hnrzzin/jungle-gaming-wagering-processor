import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UnprocessableEntityException,
  UnauthorizedException,
  Headers,
  Body,
} from "@nestjs/common";
import {
  ProcessWager,
  ProcessWagerCurrencyMismatchError,
  ProcessWagerOwnershipError,
  ProcessWagerValidationError,
  ProcessWagerWalletNotFoundError,
} from "../../application/use-cases/process-wager";
import { PROCESS_WAGER } from "../../application/tokens";
import {
  InvalidWagerBetRequestError,
  parseWagerBetRequest,
  type WagerBetRequestBody,
} from "../../application/services/wager-bet-request";
import { mapWagerResult } from "../../application/services/wager-result-mapper";
import { timingSafeEqual } from "node:crypto";

@Controller("wagers")
export class WagerController {
  constructor(
    @Inject(PROCESS_WAGER)
    private readonly processWager: ProcessWager,
  ) {}

  @Post("bets")
  @HttpCode(HttpStatus.OK)
  async createBet(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: WagerBetRequestBody,
    @Headers("authorization") authorization: string | undefined,
  ) {
    const configuredToken = process.env.WAGER_API_TOKEN;
    const providedToken = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const expected = Buffer.from(configuredToken ?? "");
    const provided = Buffer.from(providedToken);
    const authorized =
      expected.length > 0 &&
      expected.length === provided.length &&
      timingSafeEqual(expected, provided);

    if (!authorized) {
      throw new UnauthorizedException({
        code: "WAGER_UNAUTHORIZED",
        message: "A valid provider API token is required",
      });
    }

    let command;

    try {
      command = parseWagerBetRequest(body, idempotencyKey);

      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      if (!uuidPattern.test(command.playerId) || !uuidPattern.test(command.walletId)) {
        throw new BadRequestException({
          code: "INVALID_WALLET_REFERENCE",
          message: "playerId and walletId must be valid UUIDs",
        });
      }
    } catch (error) {
      if (error instanceof InvalidWagerBetRequestError) {
        throw new BadRequestException({
          code: "INVALID_REQUEST",
          message: error.message,
        });
      }

      throw error;
    }

    try {
      const result = await this.processWager.execute(command);

      switch (result.outcome) {
        case "PROCESSED":
        case "DUPLICATE":
          return mapWagerResult(result);

        case "REJECTED":
          throw new UnprocessableEntityException({
            code: result.transaction.failureCode,
            message: "Wager rejected",
            transaction: mapWagerResult(result).transaction,
          });

        case "CONFLICT":
          throw new ConflictException({
            code: "IDEMPOTENCY_CONFLICT",
            message:
              "The idempotency key or external transaction ID was already used with a different payload",
            transaction: mapWagerResult(result).transaction,
          });
      }
    } catch (error) {
      if (
        error instanceof ProcessWagerWalletNotFoundError ||
        error instanceof ProcessWagerOwnershipError
      ) {
        throw new NotFoundException({
          code: "WALLET_NOT_FOUND",
          message: "Wallet not found",
        });
      }

      if (
        error instanceof ProcessWagerCurrencyMismatchError ||
        error instanceof ProcessWagerValidationError
      ) {
        throw new UnprocessableEntityException({
          code: "INVALID_WAGER",
          message: error.message,
        });
      }

      throw error;
    }
  }
}