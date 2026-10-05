import { useEffect, useState, type FormEvent } from "react";
import {
  fetchMeta,
  fetchOwnerSession,
  ownerCreateSession,
  ownerEstablishManager,
  ownerIssueSetupInvitation,
  ownerLogout,
  ownerRecoverManagerPassword,
  type MetaInfo,
} from "./api";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function welcomeInviteUrl(token: string): string {
  const base = `${window.location.origin}/welcome`;
  return `${base}#invite=${encodeURIComponent(token)}`;
}

export function OwnerApp() {
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [ownerActive, setOwnerActive] = useState(false);
  const [secret, setSecret] = useState("");
  const [invitation, setInvitation] = useState<{
    token: string;
    expiresAt: string;
    link: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRecover, setShowRecover] = useState(false);
  const [recoverLogin, setRecoverLogin] = useState("");
  const [recoverPassphrase, setRecoverPassphrase] = useState("");
  const [establishOpen, setEstablishOpen] = useState(false);
  const [establishLogin, setEstablishLogin] = useState("");
  const [establishPassphrase, setEstablishPassphrase] = useState("");
  const [establishDisplayName, setEstablishDisplayName] = useState("");

  useEffect(() => {
    void Promise.allSettled([fetchMeta(), fetchOwnerSession()]).then(
      ([metaResult, ownerResult]) => {
        if (metaResult.status === "fulfilled") setMeta(metaResult.value);
        if (ownerResult.status === "fulfilled" && ownerResult.value) {
          setOwnerActive(true);
        }
      },
    );
  }, []);

  async function submitSecret(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInvitation(null);
    try {
      await ownerCreateSession(secret);
      setOwnerActive(true);
      setSecret("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function issueInvitation() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const result = await ownerIssueSetupInvitation();
      setInvitation({
        token: result.invitationToken,
        expiresAt: result.expiresAt,
        link: welcomeInviteUrl(result.invitationToken),
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copyInviteLink() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.link);
      setCopied(true);
    } catch {
      setError("Could not copy the link. Select and copy it manually.");
    }
  }

  async function signOutOwner() {
    setBusy(true);
    setError(null);
    try {
      await ownerLogout();
      setOwnerActive(false);
      setInvitation(null);
      setShowRecover(false);
      setEstablishOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitRecover(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ownerRecoverManagerPassword({
        loginName: recoverLogin.trim(),
        newPassphrase: recoverPassphrase,
      });
      setShowRecover(false);
      setRecoverLogin("");
      setRecoverPassphrase("");
      setError(null);
      alert("Manager password updated. They can sign in with the new passphrase.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitEstablish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ownerEstablishManager({
        loginName: establishLogin.trim(),
        passphrase: establishPassphrase,
        displayName: establishDisplayName.trim(),
      });
      window.location.assign("/today");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const ownerConfigured = meta?.ownerConfigured ?? false;

  return (
    <main className="app-shell owner-shell">
      <section className="panel owner-panel">
        <p className="eyebrow">Installation owner</p>
        <h1 className="page-heading">Protected setup access</h1>
        {!ownerConfigured ? (
          <p className="meta" role="status" data-testid="owner-not-configured">
            Installation owner is not configured on this server. Set{" "}
            <code>INSTALLATION_OWNER_SECRET</code> in deployment settings before using this page.
            Existing household use is unchanged; browser setup and reset stay unavailable until then.
          </p>
        ) : null}

        {ownerConfigured && !ownerActive ? (
          <form className="form-grid" onSubmit={submitSecret} data-testid="owner-secret-form">
            <p className="meta">
              Enter the installation owner secret from your password manager. It is not stored in
              this browser.
            </p>
            <label>
              Owner secret
              <input
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                required
                data-testid="owner-secret-input"
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        ) : null}

        {ownerConfigured && ownerActive ? (
          <div className="owner-actions" data-testid="owner-console">
            <p className="meta" role="status">
              Owner session is active. Issue a one-time setup invitation for the parent setting up
              this household.
            </p>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void issueInvitation()}
              data-testid="owner-issue-invite"
            >
              {busy ? "Working…" : "Issue setup invitation"}
            </button>

            {invitation ? (
              <div className="owner-invite-card" data-testid="owner-invite-card">
                <p className="form-warning" role="status">
                  This invitation is shown once. Copy the link now; it cannot be recovered from
                  this screen later.
                </p>
                <label>
                  Setup link (same origin, fragment only)
                  <input
                    readOnly
                    value={invitation.link}
                    data-testid="owner-invite-link"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
                <p className="meta">Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
                <div className="button-row">
                  <button type="button" onClick={() => void copyInviteLink()} disabled={busy}>
                    {copied ? "Copied" : "Copy link"}
                  </button>
                </div>
              </div>
            ) : null}

            <details className="owner-recovery">
              <summary>Recover manager access</summary>
              <p className="meta">
                Reset an existing manager&apos;s password without erasing household data, or
                establish a manager when none can sign in.
              </p>
              {!showRecover ? (
                <button type="button" className="secondary" onClick={() => setShowRecover(true)}>
                  Reset manager password…
                </button>
              ) : (
                <form className="form-grid" onSubmit={submitRecover}>
                  <label>
                    Manager login name
                    <input
                      autoComplete="username"
                      value={recoverLogin}
                      onChange={(event) => setRecoverLogin(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    New passphrase
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={recoverPassphrase}
                      onChange={(event) => setRecoverPassphrase(event.target.value)}
                      required
                    />
                  </label>
                  <div className="button-row">
                    <button type="submit" className="primary" disabled={busy}>
                      Update password
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setShowRecover(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {!establishOpen ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEstablishOpen(true)}
                >
                  Establish manager for retained household…
                </button>
              ) : (
                <form className="form-grid" onSubmit={submitEstablish}>
                  <p className="meta">
                    Creates a manager for existing household data. This is not empty setup.
                  </p>
                  <label>
                    Display name
                    <input
                      autoComplete="name"
                      value={establishDisplayName}
                      onChange={(event) => setEstablishDisplayName(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Login name
                    <input
                      autoComplete="username"
                      value={establishLogin}
                      onChange={(event) => setEstablishLogin(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Passphrase
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={establishPassphrase}
                      onChange={(event) => setEstablishPassphrase(event.target.value)}
                      required
                    />
                  </label>
                  <div className="button-row">
                    <button type="submit" className="primary" disabled={busy}>
                      Establish and sign in
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setEstablishOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </details>

            <button type="button" className="text-button" disabled={busy} onClick={() => void signOutOwner()}>
              Sign out owner session
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
