import { getDb } from "@/lib/db";

export async function GET() {
  try {
    getDb().prepare("SELECT 1 AS ok").get();
    return Response.json({ status: "healthy", database: "sqlite", version: "0.3.0" });
  } catch (error) {
    return Response.json({ status: "unhealthy", error: error instanceof Error ? error.message : "Database error" }, { status: 503 });
  }
}
