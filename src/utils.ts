export function isPrivateChat(remoteRoomId: string): boolean {
  return remoteRoomId.startsWith("p");
}
export function getOicqIdFromRoomId(remoteRoomId: string): number {
  return parseInt(remoteRoomId.slice(1));
}
