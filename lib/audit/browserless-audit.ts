function buildBrowserlessEndpoint(token: string) {
  const endpoint = new URL(
    process.env.BROWSERLESS_WS_URL ||
    "wss://production-sfo.browserless.io"
  );

  if (!endpoint.searchParams.has("token")) {
    endpoint.searchParams.set("token", token);
  }

  return endpoint.toString();
}
