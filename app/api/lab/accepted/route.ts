export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return Response.json({ accepted: true, receivedKeys: Object.keys(body), note: "Lab response only; not proof of database persistence." }, { status: 201 });
}
