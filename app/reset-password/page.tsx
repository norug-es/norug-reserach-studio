import { PasswordRecoveryForm } from "@/components/password-recovery-form";

type Props = { searchParams: Promise<{ token?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token = "" } = await searchParams;
  return <main className="login-page"><PasswordRecoveryForm mode="reset" token={token} /></main>;
}
