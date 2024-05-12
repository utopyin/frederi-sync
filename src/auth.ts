import { MiddlewareHandler } from "hono";
import { Env } from ".";

export const protect: MiddlewareHandler<Env> = async (c, next) => {
	const url = new URL(c.req.url);
	if (url.pathname.startsWith("/public")) {
		return await next();
	}
	const password = c.req.header("Authorization");
	if (password !== c.env.PASSWORD) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
};
