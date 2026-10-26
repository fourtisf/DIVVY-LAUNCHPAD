import type { FastifyReply } from "fastify";
import type { ApiError, CheckResult } from "@divvy/shared";

/** Error contract (HANDOFF §5): every refusal is {code, message, collidesWith}. */
export function sendError(reply: FastifyReply, status: number, code: string, message: string, collidesWith: ApiError["collidesWith"] = null) {
  const body: ApiError = { code, message, collidesWith };
  return reply.code(status).send(body);
}

export function sendCheckFailure(reply: FastifyReply, check: CheckResult) {
  return sendError(reply, 422, check.code, check.message, check.collidesWith);
}
