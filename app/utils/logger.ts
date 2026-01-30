import pino, { type LevelWithSilent, type Logger } from "pino";

type PinoConfig = Parameters<typeof pino>[0];

const nodeEnv = process.env["NODE_ENV"];
const isDev =
  nodeEnv === "development" ||
  process.env["NUXT_DEV"] === "true" ||
  process.env["NITRO_DEV"] === "true";

// In some deployment environments `NODE_ENV` is unset; default to production-like behavior.
const isProd = nodeEnv === "production" || (!nodeEnv && !isDev);

const configuredLevel = process.env["LOG_LEVEL"];
const level: LevelWithSilent = (configuredLevel ??
  (isProd ? "warn" : "debug")) as LevelWithSilent;

const enablePretty =
  isDev && typeof process !== "undefined" && Boolean(process.stdout?.isTTY);

const pinoConfig: PinoConfig = {
  level,
  browser: {
    asObject: isProd,
  },
  ...(enablePretty
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
          },
        },
      }
    : {}),
};

export const logger: Logger = pino(pinoConfig);
