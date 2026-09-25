export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadConfig } = await import("./server/config");
    loadConfig(process.env);
  }
}
