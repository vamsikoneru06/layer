"use client";

import { Copy } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useSetMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { getMe, twoFactor, type Me } from "@/lib/api";

const errorText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");

/** The base32 key an authenticator app asks for, in groups of four so it's easier to type. */
const setupKey = (totpURI: string) => (new URL(totpURI).searchParams.get("secret") ?? "").replace(/(.{4})/g, "$1 ").trim();

function CopyButton({ text, what }: { text: string; what: string }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast({ message: `${what} copied.` });
    } catch {
      toast({ message: "Couldn't copy. Select the text and copy it instead." });
    }
  }
  return (
    <Button variant="secondary" size="sm" onClick={copy} icon={<Copy aria-hidden className="size-3.5" />}>
      Copy
    </Button>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Backup codes let you in if you lose your phone. Each one works once. Keep them somewhere safe, not on this device.</p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-field px-4 py-3 font-mono text-sm tabular-nums sm:grid-cols-3">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div>
        <CopyButton text={codes.join("\n")} what="Backup codes" />
      </div>
    </div>
  );
}

/** A 6-digit authenticator code, or (when `allowBackup`) one of the backup codes. */
function CodeForm({ submitLabel, allowBackup = false, onVerified }: { submitLabel: string; allowBackup?: boolean; onVerified: () => Promise<void> }) {
  const id = useId();
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = backup ? code.trim() : code.replace(/\s/g, "");
  const ready = backup ? value.length > 0 : /^\d{6}$/.test(value);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await (backup ? twoFactor.verifyBackupCode(value) : twoFactor.verifyCode(value));
      await onVerified();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <label htmlFor={`${id}-code`} className="flex flex-1 flex-col gap-2 text-[13px] font-medium">
          {backup ? "Backup code" : "6-digit code from your authenticator app"}
          <input
            id={`${id}-code`}
            className="field tabular-nums"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            inputMode={backup ? "text" : "numeric"}
            autoComplete="one-time-code"
            maxLength={backup ? 32 : 7}
          />
        </label>
        <Button type="submit" loading={busy} disabled={!ready}>
          {submitLabel}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {allowBackup && (
        <button
          type="button"
          className="w-fit text-[13px] text-muted underline-offset-2 hover:text-text hover:underline"
          onClick={() => {
            setBackup(!backup);
            setCode("");
            setError(null);
          }}
        >
          {backup ? "Use a code from your authenticator app" : "Use a backup code instead"}
        </button>
      )}
    </form>
  );
}

/** Settings for admins: admin tools need an authenticator code on top of the sign-in link. */
export function TwoFactorSection({ me }: { me: Me }) {
  const setMe = useSetMe();
  const toast = useToast();
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"enable" | "codes" | "disable" | null>(null);
  const [pending, setPending] = useState<"codes" | "disable" | null>(null);
  const { enabled, unlockedUntil } = me.twoFactor;

  async function refresh() {
    const next = await getMe();
    if (next) setMe(next);
  }

  async function run<T>(action: "enable" | "codes" | "disable", call: () => Promise<T>, done: (result: T) => Promise<void> | void) {
    setBusy(action);
    try {
      await done(await call());
    } catch (err) {
      toast({ message: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  let body;
  if (setup) {
    const key = setupKey(setup.totpURI);
    body = (
      <ol className="flex list-decimal flex-col gap-6 pl-5 text-sm marker:text-muted">
        {/* Flex goes on an inner div: a flex <li> loses its list number. */}
        <li>
          <div className="flex flex-col gap-3">
            <p>
              In your authenticator app, add an account and enter this setup key. On a phone, you can{" "}
              <a href={setup.totpURI} className="underline underline-offset-2">
                open it in the app
              </a>{" "}
              instead.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <code className="rounded-lg bg-field px-3 py-2 font-mono text-sm tracking-wide break-all">{key}</code>
              <CopyButton text={key.replace(/\s/g, "")} what="Setup key" />
            </div>
          </div>
        </li>
        <li>
          <BackupCodes codes={setup.backupCodes} />
        </li>
        <li>
          <div className="flex flex-col gap-3">
            <p>Enter the code your app shows to finish.</p>
            <CodeForm
              submitLabel="Turn on"
              onVerified={async () => {
                setSetup(null);
                await refresh();
                toast({ message: "Two-step verification is on." });
              }}
            />
          </div>
        </li>
      </ol>
    );
  } else if (!enabled) {
    body = (
      <div>
        <Button loading={busy === "enable"} onClick={() => run("enable", twoFactor.enable, setSetup)}>
          Set up
        </Button>
      </div>
    );
  } else if (!unlockedUntil) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm">On. Enter a code to use admin tools on this device.</p>
        <CodeForm
          submitLabel="Unlock"
          allowBackup
          onVerified={async () => {
            await refresh();
            toast({ message: "Admin tools unlocked on this device." });
          }}
        />
      </div>
    );
  } else {
    const until = new Date(unlockedUntil).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    body = (
      <div className="flex flex-col gap-4">
        <p className="text-sm">On. Admin tools are unlocked on this device until {until}.</p>
        {newCodes && <BackupCodes codes={newCodes} />}
        {pending ? (
          // Changing two-factor needs a fresh code (the server checks it was entered in the last 10 minutes).
          <div className="flex flex-col gap-3 rounded-xl bg-field p-4">
            <p className="text-sm">
              {pending === "codes"
                ? "Enter a code to replace your backup codes. The old ones stop working."
                : "Enter a code to turn off two-step verification. Admin tools stay locked until you set it up again."}
            </p>
            <CodeForm
              submitLabel={pending === "codes" ? "Replace codes" : "Turn off"}
              allowBackup
              onVerified={() =>
                pending === "codes"
                  ? run("codes", twoFactor.newBackupCodes, async (r) => {
                      setPending(null);
                      setNewCodes(r.backupCodes);
                      await refresh();
                    })
                  : run("disable", twoFactor.disable, async () => {
                      setPending(null);
                      setNewCodes(null);
                      await refresh();
                      toast({ message: "Two-step verification is off." });
                    })
              }
            />
            <div>
              <Button variant="secondary" size="sm" onClick={() => setPending(null)} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setPending("codes")}>
              New backup codes
            </Button>
            <Button variant="danger" onClick={() => setPending("disable")}>
              Turn off
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Two-step verification</h2>
        <p className="text-sm text-muted">
          Admin tools need a code from an authenticator app, such as Google Authenticator, Microsoft Authenticator or 1Password, as well as your
          sign-in.
        </p>
      </div>
      {body}
    </section>
  );
}
