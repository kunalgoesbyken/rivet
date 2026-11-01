import { describe, expect, test } from "vitest";
import { ActorConnRaw, CONNECT_SYMBOL } from "@/client/actor-conn";
import { ACTOR_CONNS_SYMBOL, type ClientRaw } from "@/client/client";
import { ActorError } from "@/client/errors";
import {
	isRetryableLifecycleReconnectSignal,
	isRetryableLifecycleRequestError,
} from "@/client/lifecycle-errors";
import type { EngineControlClient } from "@/engine-client/driver";

function depotUnavailable() {
	return new ActorError(
		"depot",
		"unavailable",
		"The storage host could not finish the command (routing_unavailable); its outcome may be unknown.",
	);
}

describe("lifecycle error classification", () => {
	test("reconnects on depot.unavailable without replaying requests", () => {
		const error = depotUnavailable();

		expect(isRetryableLifecycleReconnectSignal(error)).toBe(true);
		expect(isRetryableLifecycleRequestError(error)).toBe(false);
	});

	test("connection retries the open after depot.unavailable", async () => {
		let attempts = 0;
		let reopened!: () => void;
		const reopen = new Promise<"reopened">((resolve) => {
			reopened = () => resolve("reopened");
		});
		const driver = {
			openWebSocket: async () => {
				attempts += 1;
				if (attempts === 1) throw depotUnavailable();
				reopened();
				return new Promise(() => {});
			},
		} as unknown as EngineControlClient;
		const client = {
			[ACTOR_CONNS_SYMBOL]: new Set(),
		} as unknown as ClientRaw;
		const conn = new ActorConnRaw(
			client,
			driver,
			undefined,
			undefined,
			"json",
			{ getForId: { name: "test", actorId: "actor-id" } },
		);
		conn.onError(() => {});
		const idle = new Promise<"idle">((resolve) => {
			conn.onStatusChange((status) => {
				if (status === "idle") resolve("idle");
			});
		});

		conn[CONNECT_SYMBOL]();
		const outcome = await Promise.race([reopen, idle]);
		await conn.dispose();

		expect(outcome).toBe("reopened");
	});
});
