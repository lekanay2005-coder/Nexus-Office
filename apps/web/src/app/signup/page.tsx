import LoginPage from "@/app/login/page";

// Addendum 1 specified a "Continue with GitHub" button on both /login and
// /signup. The login page handles both sign-in and sign-up modes via a
// toggle; this route just pins that toggle to "signup" so /signup is its own
// addressable page (and so the button is always present here, not hidden).
export default function SignupPage() {
  return <LoginPage initialMode="signup" />;
}
