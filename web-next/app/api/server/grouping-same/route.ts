export const dynamic = "force-dynamic";

export async function GET() {
  throw new Error("sentry-poc grouping: identical boom");
}
