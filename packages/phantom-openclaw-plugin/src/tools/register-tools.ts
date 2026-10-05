/**
 * Register Phantom MCP tools as OpenClaw tools
 */

import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { loginTool, logoutTool, SessionManager, tools, type PluginConfig, type ToolContext } from "@phantom/cli";
import { PhantomApiClient } from "@phantom/phantom-api-client";
import type { OpenClawApi } from "../client/types";
import type { PluginSession } from "../session";
import * as packageJson from "../../package.json";

/**
 * Convert MCP tool JSON schema to TypeBox schema
 */
type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "null" | "object" | "array";

type JsonSchema = {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  title?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
};

const SCHEMA_OPTION_KEYS = ["description", "title", "default"] as const;
const JSON_SCHEMA_TYPES: readonly JsonSchemaType[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "null",
  "object",
  "array",
];

const PHANTOM_PROVIDER = "phantom";
const PHANTOM_CONNECTED_MESSAGE =
  "Phantom wallet connected. You can transfer tokens, swap, sign messages, and more across Solana and Ethereum.";
const ANALYTICS_HEADER_PLATFORM = "x-phantom-platform";
const ANALYTICS_HEADER_CLIENT = "x-phantom-client";
const ANALYTICS_HEADER_SDK_VERSION = "x-phantom-sdk-version";
const TOOL_DESCRIPTION_OVERRIDES: Record<string, string> = {
  transfer_tokens: "Transfers tokens using your Phantom embedded wallet",
  buy_token:
    "Fetches same-chain and multichain swap quotes from Phantom's quotes API, including EVM to Solana and Solana to EVM, and executes via your Phantom wallet",
  get_wallet_addresses: "Gets addresses for your Phantom embedded wallet",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJsonSchemaType(value: unknown): value is JsonSchemaType {
  return typeof value === "string" && JSON_SCHEMA_TYPES.includes(value as JsonSchemaType);
}

function pickOptions(schema: JsonSchema, keys: readonly string[]): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const key of keys) {
    const value = schema[key as keyof JsonSchema];
    if (value !== undefined) {
      options[key] = value;
    }
  }
  return options;
}

function isPrimitiveLiteral(value: unknown): value is string | number | boolean | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null;
}

function literalSchema(value: string | number | boolean | null, options: Record<string, unknown> = {}): TSchema {
  if (value === null) {
    return Type.Null(options);
  }
  return Type.Literal(value, options);
}

function toJsonSchema(value: unknown): JsonSchema {
  if (!isRecord(value)) {
    return {};
  }

  const schema: JsonSchema = {};

  if (isJsonSchemaType(value.type)) {
    schema.type = value.type;
  } else if (Array.isArray(value.type)) {
    const types = value.type.filter(isJsonSchemaType);
    if (types.length > 0) {
      schema.type = types;
    }
  }

  if (typeof value.description === "string") {
    schema.description = value.description;
  }
  if (typeof value.title === "string") {
    schema.title = value.title;
  }
  if ("default" in value) {
    schema.default = value.default;
  }
  if (Array.isArray(value.enum)) {
    schema.enum = value.enum;
  }
  if ("const" in value) {
    schema.const = value.const;
  }
  if (isRecord(value.properties)) {
    schema.properties = Object.fromEntries(
      Object.entries(value.properties).map(([key, prop]) => [key, toJsonSchema(prop)]),
    );
  }
  if (Array.isArray(value.required)) {
    schema.required = value.required.filter((item): item is string => typeof item === "string");
  }
  if (value.items !== undefined) {
    schema.items = toJsonSchema(value.items);
  }
  if (typeof value.minimum === "number") {
    schema.minimum = value.minimum;
  }
  if (typeof value.maximum === "number") {
    schema.maximum = value.maximum;
  }
  if (typeof value.exclusiveMinimum === "number") {
    schema.exclusiveMinimum = value.exclusiveMinimum;
  }
  if (typeof value.exclusiveMaximum === "number") {
    schema.exclusiveMaximum = value.exclusiveMaximum;
  }
  if (typeof value.minLength === "number") {
    schema.minLength = value.minLength;
  }
  if (typeof value.maxLength === "number") {
    schema.maxLength = value.maxLength;
  }
  if (typeof value.pattern === "string") {
    schema.pattern = value.pattern;
  }
  if (typeof value.format === "string") {
    schema.format = value.format;
  }
  if (typeof value.minItems === "number") {
    schema.minItems = value.minItems;
  }
  if (typeof value.maxItems === "number") {
    schema.maxItems = value.maxItems;
  }
  if (typeof value.uniqueItems === "boolean") {
    schema.uniqueItems = value.uniqueItems;
  }
  if (typeof value.minProperties === "number") {
    schema.minProperties = value.minProperties;
  }
  if (typeof value.maxProperties === "number") {
    schema.maxProperties = value.maxProperties;
  }
  if (typeof value.additionalProperties === "boolean") {
    schema.additionalProperties = value.additionalProperties;
  } else if (isRecord(value.additionalProperties)) {
    schema.additionalProperties = toJsonSchema(value.additionalProperties);
  }
  if (Array.isArray(value.oneOf)) {
    schema.oneOf = value.oneOf.map(toJsonSchema);
  }
  if (Array.isArray(value.anyOf)) {
    schema.anyOf = value.anyOf.map(toJsonSchema);
  }
  if (Array.isArray(value.allOf)) {
    schema.allOf = value.allOf.map(toJsonSchema);
  }

  return schema;
}

function convertEnum(schema: JsonSchema): TSchema | null {
  if (!schema.enum || schema.enum.length === 0) {
    return null;
  }

  if (!schema.enum.every(isPrimitiveLiteral)) {
    return Type.Unsafe(schema);
  }

  const baseOptions = pickOptions(schema, SCHEMA_OPTION_KEYS);
  if (schema.enum.length === 1) {
    return literalSchema(schema.enum[0], baseOptions);
  }

  return Type.Union(
    schema.enum.map(value => literalSchema(value)),
    baseOptions,
  );
}

function convertObjectSchema(schema: JsonSchema): TSchema {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const convertedProperties = Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      const converted = convertSchemaNode(value);
      return [key, required.has(key) ? converted : Type.Optional(converted)];
    }),
  );

  const options = pickOptions(schema, [...SCHEMA_OPTION_KEYS, "minProperties", "maxProperties"]);
  if (typeof schema.additionalProperties === "boolean") {
    options.additionalProperties = schema.additionalProperties;
  } else if (schema.additionalProperties) {
    options.additionalProperties = convertSchemaNode(schema.additionalProperties);
  }

  return Type.Object(convertedProperties, options);
}

function convertArraySchema(schema: JsonSchema): TSchema {
  const itemSchema = schema.items ? convertSchemaNode(schema.items) : Type.Unknown();
  return Type.Array(itemSchema, pickOptions(schema, [...SCHEMA_OPTION_KEYS, "minItems", "maxItems", "uniqueItems"]));
}

function convertSingleTypeSchema(schema: JsonSchema, type: JsonSchemaType): TSchema {
  switch (type) {
    case "string":
      return Type.String(pickOptions(schema, [...SCHEMA_OPTION_KEYS, "minLength", "maxLength", "pattern", "format"]));
    case "number":
      return Type.Number(
        pickOptions(schema, [...SCHEMA_OPTION_KEYS, "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]),
      );
    case "integer":
      return Type.Integer(
        pickOptions(schema, [...SCHEMA_OPTION_KEYS, "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]),
      );
    case "boolean":
      return Type.Boolean(pickOptions(schema, SCHEMA_OPTION_KEYS));
    case "null":
      return Type.Null(pickOptions(schema, SCHEMA_OPTION_KEYS));
    case "array":
      return convertArraySchema(schema);
    case "object":
      return convertObjectSchema(schema);
    default:
      return Type.Unknown(pickOptions(schema, SCHEMA_OPTION_KEYS));
  }
}

function convertSchemaNode(schema: JsonSchema): TSchema {
  const enumSchema = convertEnum(schema);
  if (enumSchema) {
    return enumSchema;
  }

  if (schema.const !== undefined && isPrimitiveLiteral(schema.const)) {
    return literalSchema(schema.const, pickOptions(schema, SCHEMA_OPTION_KEYS));
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    return Type.Union(schema.oneOf.map(convertSchemaNode), pickOptions(schema, SCHEMA_OPTION_KEYS));
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    return Type.Union(schema.anyOf.map(convertSchemaNode), pickOptions(schema, SCHEMA_OPTION_KEYS));
  }

  if (schema.allOf && schema.allOf.length > 0) {
    return Type.Intersect(schema.allOf.map(convertSchemaNode), pickOptions(schema, SCHEMA_OPTION_KEYS));
  }

  if (schema.type === undefined) {
    if (schema.properties) {
      return convertObjectSchema({ ...schema, type: "object" });
    }
    if (schema.items) {
      return convertArraySchema({ ...schema, type: "array" });
    }
    return Type.Unknown(pickOptions(schema, SCHEMA_OPTION_KEYS));
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length === 1) {
    return convertSingleTypeSchema(schema, types[0]);
  }

  return Type.Union(
    types.map(type => convertSingleTypeSchema(schema, type)),
    pickOptions(schema, SCHEMA_OPTION_KEYS),
  );
}

function convertSchema(mcpSchema: unknown): TSchema {
  return convertSchemaNode(toJsonSchema(mcpSchema));
}

function getToolDescription(toolName: string, defaultDescription: string): string {
  return TOOL_DESCRIPTION_OVERRIDES[toolName] ?? defaultDescription;
}

function addProviderAttribution(result: unknown): unknown {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return {
      ...(result as Record<string, unknown>),
      provider: PHANTOM_PROVIDER,
    };
  }

  return {
    provider: PHANTOM_PROVIDER,
    result: result ?? null,
  };
}

function addPluginVersion(result: unknown): unknown {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return {
      ...(result as Record<string, unknown>),
      openClawPluginVersion: packageJson.version,
    };
  }
  return result;
}

/**
 * Register all Phantom MCP tools with OpenClaw
 */
export function registerPhantomTools(api: OpenClawApi, pluginSession: PluginSession, config: PluginConfig): void {
  const apiClient = new PhantomApiClient({
    baseUrl: config.PHANTOM_API_BASE_URL ?? "https://api.phantom.app",
  });
  const manager = new SessionManager();

  const staticHeaders: Record<string, string> = {
    [ANALYTICS_HEADER_PLATFORM]: "ext-sdk",
    [ANALYTICS_HEADER_CLIENT]: "mcp",
    [ANALYTICS_HEADER_SDK_VERSION]: config.PHANTOM_VERSION ?? packageJson.version ?? "unknown",
  };
  apiClient.setHeaders(staticHeaders);
  apiClient.setGetHeaders(() => pluginSession.getOAuthHeaders());

  if ("registerContext" in api && typeof api.registerContext === "function") {
    api.registerContext({
      id: "phantom-wallet-connected",
      description: PHANTOM_CONNECTED_MESSAGE,
      content: PHANTOM_CONNECTED_MESSAGE,
    });
  }

  for (const mcpTool of tools) {
    api.registerTool({
      name: mcpTool.name,
      description: getToolDescription(mcpTool.name, mcpTool.description),
      parameters: convertSchema(mcpTool.inputSchema),
      async execute(_id: string, params: Record<string, unknown>) {
        // Create tool context for MCP tool with recursive logger

        const createLogger = (prefix: string): any => ({
          info: (msg: string) => console.info(`[${prefix}] ${msg}`), // eslint-disable-line no-console
          error: (msg: string) => console.error(`[${prefix}] ${msg}`),
          debug: (msg: string) => console.debug(`[${prefix}] ${msg}`), // eslint-disable-line no-console
          child: (name: string) => createLogger(`${prefix}:${name}`),
        });

        const logger = createLogger(mcpTool.name);
        const displayMode = params.displayMode === "browser" ? "browser" : "text";

        if (mcpTool.name === "get_connection_status" && !pluginSession.isInitialized()) {
          const normalized = addProviderAttribution(
            addPluginVersion({
              connected: false,
              reason: `No active session found. Call ${loginTool.name} or another wallet tool to authenticate.`,
            }),
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(normalized, null, 2),
              },
            ],
          };
        }

        const context: ToolContext = {
          logger,
          apiClient,
          manager,
        };

        try {
          if (mcpTool.name === logoutTool.name) {
            await pluginSession.logout();
            const normalized = addProviderAttribution({ success: true, message: "Logged out successfully." });
            return {
              content: [{ type: "text" as const, text: JSON.stringify(normalized, null, 2) }],
            };
          } else if (mcpTool.name === loginTool.name) {
            if (displayMode === "browser") {
              await pluginSession.resetSession({ openBrowser: true });
            } else {
              const authState = await pluginSession.startTextModeAuthentication();
              if (authState.status === "pending") {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: JSON.stringify(
                        addProviderAttribution({
                          success: false,
                          status: "pending_authentication",
                          prompt: authState.prompt,
                        }),
                        null,
                        2,
                      ),
                    },
                  ],
                };
              }
            }
          } else {
            if (!pluginSession.isInitialized()) {
              const authState = await pluginSession.startTextModeAuthentication();
              if (authState.status === "pending") {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: JSON.stringify(
                        {
                          provider: PHANTOM_PROVIDER,
                          error: "AUTHENTICATION_REQUIRED",
                          prompt: authState.prompt,
                        },
                        null,
                        2,
                      ),
                    },
                  ],
                  isError: true,
                };
              }
            }

            await pluginSession.initialize();
            await manager.initialize();
          }

          const sessionData = pluginSession.getSession();
          const appId =
            config.PHANTOM_APP_ID ??
            config.PHANTOM_CLIENT_ID ??
            (typeof sessionData.appId === "string" ? sessionData.appId : undefined);
          if (appId) {
            apiClient.setHeaders({
              "x-api-key": appId,
              "X-App-Id": appId,
            });
          }

          const result =
            mcpTool.name === loginTool.name
              ? {
                  success: true,
                  message: "Authentication successful.",
                  walletId: sessionData.walletId,
                  authFlow: sessionData.authFlow ?? "device-code",
                }
              : await mcpTool.handler(params, context);

          const versioned = mcpTool.name === "get_connection_status" ? addPluginVersion(result) : result;
          const normalized = addProviderAttribution(versioned);
          return {
            content: [
              {
                type: "text" as const,
                text: typeof normalized === "string" ? normalized : JSON.stringify(normalized, null, 2),
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ provider: PHANTOM_PROVIDER, error: errorMessage }, null, 2),
              },
            ],
            isError: true,
          };
        }
      },
    });
  }
}
