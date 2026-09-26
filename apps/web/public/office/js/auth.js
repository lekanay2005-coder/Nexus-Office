// Auth for the static UI: talks to Supabase directly with the anon key
// fetched from /api/config. Sessions live in the same sb-* cookies the
// Next.js server reads, so both apps share one login.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { getConfig } from "./api.js";

let supabase = null;
let session = null;

export function getSupabase() {
  return supabase;
}

export function getSession() {
  return session;
}

export async function initAuth() {
  const config = await getConfig();
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data } = await supabase.auth.getSession();
  session = data.session ?? null;
  return session;
}

// Redirects the browser to GitHub OAuth; on success the provider sends the
// user back with a session code that supabase-js detects on load.
export async function signInWithGithub() {
  await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${window.location.origin}/office/`,
      scopes: "read:user user:email repo",
    },
  });
}

// Renders a sign-in / sign-up form into `host` and resolves (without
// navigating away) once the user is signed in with email+password.
export function renderAuthView(host, onSignedIn) {
  let mode = "signin";

  const title = document.createElement("h1");
  const sub = document.createElement("p");
  const email = document.createElement("input");
  email.type = "email";
  email.required = true;
  email.placeholder = "Email";
  email.className = "input";
  email.autocomplete = "email";
  const password = document.createElement("input");
  password.type = "password";
  password.required = true;
  password.minLength = 6;
  password.placeholder = "Password";
  password.className = "input";
  password.autocomplete = "current-password";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn primary";
  const status = document.createElement("p");
  status.className = "error-text";
  status.style.margin = "0";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "alt";
  const githubBtn = document.createElement("button");
  githubBtn.type = "button";
  githubBtn.className = "btn";
  githubBtn.textContent = "Continue with GitHub";
  githubBtn.addEventListener("click", () => signInWithGithub().catch(() => {}));

  function paint() {
    title.textContent = "Nexus Office";
    sub.textContent = mode === "signin" ? "Sign in to your workspace" : "Create your account";
    submit.textContent = mode === "signin" ? "Sign in" : "Sign up";
    toggle.textContent = mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in";
    status.textContent = "";
  }

  const form = document.createElement("form");
  form.append(email, password, submit);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    status.textContent = "";
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
        : await supabase.auth.signUp({ email: email.value, password: password.value });
    submit.disabled = false;
    if (error) {
      status.textContent = error.message;
      return;
    }
    if (mode === "signup") {
      status.style.color = "var(--warn)";
      status.textContent = "Check your email to confirm your account, then sign in.";
      return;
    }
    const { data } = await supabase.auth.getSession();
    session = data.session ?? null;
    if (session) onSignedIn();
  });

  toggle.addEventListener("click", () => {
    mode = mode === "signin" ? "signup" : "signin";
    paint();
  });

  paint();

  const card = document.createElement("div");
  card.className = "glass auth-card";
  card.append(title, sub, form, status, toggle, githubBtn);
  const view = document.createElement("div");
  view.className = "auth-view";
  view.append(card);
  host.append(view);
}
