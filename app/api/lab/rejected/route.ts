export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return Response.json({ accepted: false, receivedKeys: Object.keys(body), error: "Lab validation rejection." }, { status: 400 });
}
