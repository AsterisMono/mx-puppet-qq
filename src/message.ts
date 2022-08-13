import {
  IMessageEvent,
  IReceiveParams,
  Log,
  PuppetBridge,
} from "mx-puppet-bridge";
import { Friend, Group, MessageElem } from "oicq";
import { text } from "stream/consumers";

const log = new Log("oicqPuppet:messageParser");

// TODO: QQ消息格式处理
export async function parseOicqMessage(
  source: Friend | Group,
  messageChain: MessageElem[],
  bridge: PuppetBridge,
  sendParams: IReceiveParams
) {
  // log.info("接收到的消息类型：" + sendParams.room.isDirect ? "私聊" : "群");
  for (let message of messageChain) {
    switch (message.type) {
      case "text":
        await bridge.sendMessage(sendParams, {
          body: message.text,
        });
        break;
      case "image":
        await bridge.sendImage(sendParams, message.url as string); // FIXME: 处理其他情况
        break;
      case "file":
        if (source instanceof Friend) {
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
      default:
        await bridge.sendMessage(sendParams, {
          body: message.toString(),
        });
        break;
    }
  }
}
