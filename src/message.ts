import {
  IMessageEvent,
  IReceiveParams,
  Log,
  PuppetBridge,
} from "mx-puppet-bridge";
import { MessageElem } from "oicq";
import { text } from "stream/consumers";

const log = new Log("oicqPuppet:messageParser");

// TODO: QQ消息格式处理
export async function parseOicqMessage(
  messageChain: MessageElem[],
  bridge: PuppetBridge,
  sendParams: IReceiveParams
) {
  log.info("接收到的消息类型：" + sendParams.room.isDirect ? "私聊" : "群");
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
      default:
        await bridge.sendMessage(sendParams, {
          body: message.toString(),
        });
        break;
    }
  }
}
