import { InvitationAcceptForm } from "@/components/invitation-accept-form";

type Props = { searchParams: Promise<{ token?: string }> };

export default async function InvitationAcceptPage({ searchParams }: Props) {
  const { token = "" } = await searchParams;
  return <main className="login-page"><InvitationAcceptForm token={token} /></main>;
}
