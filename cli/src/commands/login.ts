import { createInterface } from "node:readline/promises";
import { buildCommand } from "@stricli/core";
import type { AuthType } from "@earendil-works/pi-ai";
import { interaction } from "../auth.ts";
import { authFlag, createModels, type LocalContext } from "../context.ts";

interface LoginFlags {
  readonly auth: string;
  readonly type?: AuthType;
}

export const loginCommand = buildCommand({
  async func(this: LocalContext, flags: LoginFlags, providerId: string): Promise<void> {
    const models = createModels(flags.auth);
    const provider = models.getProvider(providerId);
    if (!provider) {
      const withLogin = models
        .getProviders()
        .filter((p) => p.auth.oauth || p.auth.apiKey?.login)
        .map((p) => p.id);
      throw new Error(`unknown provider ${providerId}. Known providers: ${withLogin.join(", ")}`);
    }
    const type: AuthType = flags.type ?? (provider.auth.oauth ? "oauth" : "api_key");
    if (type === "oauth" && !provider.auth.oauth)
      throw new Error(`provider ${providerId} does not support OAuth login`);
    if (type === "api_key" && !provider.auth.apiKey?.login)
      throw new Error(`provider ${providerId} does not support API key login`);

    const log = (line: string) => this.process.stderr.write(`${line}\n`);
    const rl = createInterface({ input: this.process.stdin, output: this.process.stderr });
    try {
      await models.login(providerId, type, interaction(rl, log));
    } finally {
      rl.close();
    }
    log(`saved ${type} credentials for ${providerId} to ${flags.auth}`);
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "pi-ai provider id",
          parse: String,
          placeholder: "provider"
        }
      ]
    },
    flags: {
      auth: authFlag,
      type: {
        kind: "enum",
        values: ["oauth", "api_key"],
        brief: "Credential type (defaults to oauth if supported)",
        optional: true
      }
    }
  },
  docs: {
    brief: "Log in to a provider and store the credential in the auth file."
  }
});
