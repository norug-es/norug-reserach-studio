import { databaseHealth } from "@/lib/db";

export async function GET() {
  try {
    const database = await databaseHealth();
    return Response.json({
      status: "healthy",
      service: "norug-research-studio",
      version: "0.4.1",
      database: { engine: "postgresql", ...database },
    });
  } catch (error) {
    return Response.json({
      status: "unhealthy",
      service: "norug-research-studio",
      version: "0.4.1",
      database: { engine: "postgresql", connected: false },
      error: error instanceof Error ? error.message : "Database error",
    }, { status: 503 });
  }
}
