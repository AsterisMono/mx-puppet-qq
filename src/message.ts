import { IReceiveParams, Log, PuppetBridge } from "mx-puppet-bridge";
import { GroupMessageEvent, PrivateMessageEvent } from "oicq";

const log = new Log("oicqPuppet:messageParser");

// TODO: QQ消息格式处理
export async function parseOicqMessage(
  messageEvent: PrivateMessageEvent | GroupMessageEvent,
  bridge: PuppetBridge,
  sendParams: IReceiveParams
) {
  const messageChain = messageEvent.message;
  const source = (messageEvent as PrivateMessageEvent).friend || undefined;
  // 处理回复
  console.log(messageEvent);
  if (messageEvent.source) {
    // TODO: 重新设计remoteEventId，使用rand和seq
  }
  let buffer = "";
  for (let message of messageChain) {
    switch (message.type) {
      case "text":
        buffer = buffer.concat(message.text);
        await bridge.sendMessage(sendParams, {
          body: buffer,
        });
        buffer = "";
        break;
      case "image":
        await bridge.sendImage(sendParams, message.url as string, "image");
        break;
      case "file":
        if (sendParams.room.isDirect) {
          await bridge.sendFile(
            sendParams,
            await source.getFileUrl(message.fid),
            message.name
          );
        } else {
          // 是群文件，默认不下载，使用群文件模块访问就行
          await bridge.sendMessage(sendParams, {
            // TODO: 给群文件增加下载链接
            body: `上传了新的群文件：${message.name}`,
          });
        }
        break;
      case "at":
        buffer = buffer.concat(message.text as string);
        break;
      default:
        await bridge.sendMessage(sendParams, {
          body: "暂不支持的消息",
        });
        break;
    }
  }
}
