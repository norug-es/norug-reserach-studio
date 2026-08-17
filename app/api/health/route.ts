import { databaseHealth } from "@/lib/db";

export async function GET() {
  try {
    const database = await databaseHealth();
    if (!database.rlsEnforced) {
      return Response.json({
        status: "unhealthy",
        service: "norug-research-studio",
        version: "0.5.0",
        database: { engine: "postgresql", ...database },
        error: "DATABASE_URL utiliza un rol con SUPERUSER o BYPASSRLS",
      }, { status: 503 });
    }
    return Response.json({
      status: "healthy",
      service: "norug-research-studio",
      version: "0.5.0",
      database: { engine: "postgresql", ...database },
    });
  } catch (error) {
    return Response.json({
      status: "unhealthy",
      service: "norug-research-studio",
      version: "0.5.0",
      database: { engine: "postgresql", connected: false },
      error: error instanceof Error ? error.message : "Database error",
    }, { status: 503 });
  }
}
