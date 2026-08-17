export async function GET() {
  return Response.json({ status: "alive", version: "0.5.0" });
}
