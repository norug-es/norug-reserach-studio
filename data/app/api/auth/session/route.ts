import { getSession } from "@/lib/auth";

export async function GET() {
  const user = await getSession();
  return user ? Response.json({ user }) : Response.json({ error: "No autorizado" }, { status: 401 });
}
