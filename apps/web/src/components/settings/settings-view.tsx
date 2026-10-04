"use client";

import { LIMITS } from "@vash/schema";
import { Download, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useSession, useSetMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { deleteMe, updateMe, type Me } from "@/lib/api";
import { currentTheme, setTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

function ProfileSection({ me }: { me: Me }) {
  const id = useId();
  const toast = useToast();
  const setMe = useSetMe();
  const [name, setName] = useState(me.name);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const canSave = trimmed !== "" && trimmed !== me.name;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    try {
      // Updating the session also refreshes the name in the side bar and account menu.
      setMe(await updateMe({ name: trimmed }));
      toast({ message: "Display name updated." });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Could not save. Try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Profile</h2>
        <p className="text-sm text-muted">How your name appears in VASH.</p>
      </div>
      <form onSubmit={save} className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <label htmlFor={`${id}-name`} className="flex flex-1 flex-col gap-2 text-[13px] font-medium">
          Display name
          <input
            id={`${id}-name`}
            type="text"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={LIMITS.nameChars}
            autoComplete="name"
          />
        </label>
        <Button type="submit" loading={saving} disabled={!canSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted">Email</dt>
          <dd>{me.email}</dd>
        </div>
        {me.handle && (
          <div className="flex gap-2">
            <dt className="text-muted">Handle</dt>
            <dd>@{me.handle}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

const THEMES = [
  { value: "system", label: "System", icon: <Monitor aria-hidden className="size-4" /> },
  { value: "light", label: "Light", icon: <Sun aria-hidden className="size-4" /> },
  { value: "dark", label: "Dark", icon: <Moon aria-hidden className="size-4" /> },
] as const;

function AppearanceSection() {
  // The page is rendered with the saved choice, so read it once on the client.
  const [theme, setChoice] = useState<Theme>(() => (typeof document === "undefined" ? "system" : currentTheme()));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Appearance</h2>
        <p className="text-sm text-muted">System follows your device&apos;s light or dark setting.</p>
      </div>
      <div role="radiogroup" aria-label="Appearance" className="flex w-fit rounded-[10px] bg-field p-[3px]">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={theme === t.value}
            onClick={() => {
              setTheme(t.value);
              setChoice(t.value);
            }}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-[7px] px-3.5 text-[13px] text-muted hover:text-text",
              theme === t.value && "bg-(--seg) font-medium text-text shadow-(--segsh)",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function DataSection() {
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  async function downloadExport() {
    setDownloading(true);
    try {
      const res = await fetch("/api/me/export");
      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(problem?.detail ?? "Export failed. Try again.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vash-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ message: "Export downloaded." });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Export failed. Try again." });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Your data</h2>
        <p className="text-sm text-muted">Download a copy of your designs, folders, and profile as a JSON file.</p>
      </div>
      <div>
        <Button variant="secondary" onClick={downloadExport} loading={downloading} icon={<Download aria-hidden className="size-4" />}>
          {downloading ? "Preparing…" : "Download my data"}
        </Button>
      </div>
    </section>
  );
}

function DeleteConfirmDialog({ open, onClose, email }: { open: boolean; onClose: () => void; email: string }) {
  const id = useId();
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = confirm.trim().toLowerCase() === email.toLowerCase();

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    if (!matches || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      // The server ends the session as part of deleting the account.
      await deleteMe(confirm.trim());
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Delete your account">
      <form onSubmit={handleDelete} className="flex flex-col gap-5">
        <p className="text-sm text-muted">
          This will permanently delete your account, all your designs, uploaded media, and folders. This cannot be undone.
        </p>
        <label htmlFor={`${id}-confirm`} className="flex flex-col gap-2 text-[13px] font-medium">
          Type your email to confirm
          <input
            id={`${id}-confirm`}
            type="email"
            className="field"
            placeholder={email}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setError(null);
            }}
            autoComplete="off"
          />
        </label>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={!matches} loading={deleting}>
            {deleting ? "Deleting…" : "Delete my account"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DangerSection({ email }: { email: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Danger zone</h2>
        <p className="text-sm text-muted">Deleting your account removes all your data from VASH. Download a backup first if you need one.</p>
      </div>
      <div>
        <Button variant="danger" onClick={() => setDialogOpen(true)} icon={<Trash2 aria-hidden className="size-4" />}>
          Delete my account
        </Button>
      </div>
      <DeleteConfirmDialog open={dialogOpen} onClose={() => setDialogOpen(false)} email={email} />
    </section>
  );
}

function Divider() {
  return <div aria-hidden className="h-[.5px] bg-line" />;
}

export function SettingsView() {
  const session = useSession();

  if (session.status === "loading") {
    return (
      <div className="flex flex-col gap-10">
        <h1 className="text-[clamp(30px,5vw,40px)] leading-[1.02] font-bold tracking-[-0.035em]">Settings</h1>
        <div className="flex flex-col gap-6">
          <div className="h-5 w-32 animate-[shimmer_1.4s_ease-in-out_infinite] rounded bg-field" />
          <div className="h-10 w-64 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-xl bg-field" />
        </div>
      </div>
    );
  }

  if (session.status !== "user") {
    return (
      <div className="flex flex-col gap-10">
        <h1 className="text-[clamp(30px,5vw,40px)] leading-[1.02] font-bold tracking-[-0.035em]">Settings</h1>
        <div className="flex max-w-[560px] flex-col gap-8">
          <AppearanceSection />
          <Divider />
          <p className="text-sm text-muted">Sign in to manage your account.</p>
        </div>
      </div>
    );
  }

  const { me } = session;
  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-[clamp(30px,5vw,40px)] leading-[1.02] font-bold tracking-[-0.035em]">Settings</h1>
      <div className="flex max-w-[560px] flex-col gap-8">
        <ProfileSection me={me} />
        <Divider />
        <AppearanceSection />
        <Divider />
        <DataSection />
        <Divider />
        <DangerSection email={me.email} />
      </div>
    </div>
  );
}
