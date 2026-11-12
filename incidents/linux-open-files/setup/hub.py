"""notify-hub: держит открытыми соединения подписчиков (как WebSocket-шлюз) и шлёт им приветствие."""
import asyncio

clients = set()


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    clients.add(writer)
    try:
        writer.write(b"OK subscribed\n")
        await writer.drain()
        await reader.read()  # держим соединение, пока подписчик не отключится
    finally:
        clients.discard(writer)
        writer.close()


async def main() -> None:
    server = await asyncio.start_server(handle, "0.0.0.0", 7000, backlog=1024)
    print("notify-hub: listening on :7000", flush=True)
    async with server:
        await server.serve_forever()


asyncio.run(main())
