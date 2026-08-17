export async function GET() {
  return Response.json({ status: "alive", version: "0.4.1" });
}
