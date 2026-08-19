export async function GET() {
  return Response.json({ status: "alive", version: "0.6.2" });
}
