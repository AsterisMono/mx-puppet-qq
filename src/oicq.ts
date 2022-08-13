// first we import a few needed things again
import {
  PuppetBridge,
  IRemoteUser,
  IReceiveParams,
  IRemoteRoom,
  IMessageEvent,
  IFileEvent,
  Log,
} from "mx-puppet-bridge";
import {
  Client,
  createClient,
  DiscussMessageEvent,
  Friend,
  Group,
  GroupMessage,
  GroupMessageEvent,
  Member,
  PrivateMessage,
  PrivateMessageEvent,
  segment,
  Sendable,
} from "oicq";
import { parseOicqMessage } from "./message";
import { downloadTempFile, getOicqIdFromRoomId, isPrivateChat } from "./utils";

const log = new Log("oicqPuppet:oicq");

interface IOicqPuppet {
  client: Client;
  data: IOicqPuppetData;
}

export interface IOicqPuppetData {
  oicqId: number;
}

interface IOicqPuppets {
  [puppetId: number]: IOicqPuppet;
}

export class Oicq {
  private puppets: IOicqPuppets = {};
  constructor(private bridge: PuppetBridge) {}

  /*
   * 收信参数 IReceiveParams
   * 包括远端房间信息和发送者信息
   * 作为参数传入this.bridge.sendMessage，为Matrix端提供上下文
   */

  // 获取私聊收信参数
  public getPrivateMessageSendParams(
    puppetId: number,
    friend: Friend,
    messageId?: string
  ): IReceiveParams {
    return {
      room: {
        puppetId,
        // 私聊的roomId是qq号前加p
        roomId: `p${friend.user_id.toString()}`,
        isDirect: true,
      },
      user: {
        puppetId,
        userId: friend.user_id.toString(),
        name: friend.remark || friend.nickname,
        avatarUrl: friend.getAvatarUrl(),
      },
      eventId: messageId,
    } as IReceiveParams;
  }

  // 群消息收信参数
  public getGroupMessageSendParams(
    puppetId: number,
    group: Group,
    sender: Member,
    messageId?: string
  ): IReceiveParams {
    return {
      room: {
        puppetId,
        // 群聊的roomId是群号前加g
        roomId: `g${group.group_id.toString()}`,
        isDirect: false,
        name: group.name,
        avatarUrl: group.getAvatarUrl(),
      },
      user: {
        puppetId,
        userId: sender.user_id.toString(),
        name: sender.card || sender.info?.nickname,
        avatarUrl: sender.getAvatarUrl(),
      },
      eventId: messageId,
    } as IReceiveParams;
  }
  // 同步消息收信参数
  public getSyncedMessageSendParams(
    puppetId: number,
    fromId: number,
    toId: number,
    messageId?: string
  ): IReceiveParams {
    return {
      room: {
        puppetId,
        roomId: `p${toId.toString()}`,
        isDirect: true,
      },
      user: {
        puppetId,
        userId: fromId.toString(),
        // 应该不用加name和avatar url了，Double Puppeting会自动匹配
      },
      eventId: messageId,
    } as IReceiveParams;
  }

  public async newPuppet(puppetId: number, data: IOicqPuppetData) {
    // 初始化Puppet实例
    // 参数为PuppetId和它关联的信息
    if (this.puppets[puppetId]) {
      await this.deletePuppet(puppetId);
    }
    // 创建客户端
    const client = createClient(data.oicqId);
    this.puppets[puppetId] = {
      client,
      data,
    };
    // 这里我们姑且认为Session一定有效，直接登录
    try {
      await client.login();
      // TODO: 挂载消息hook
      client.on("message", (e) => {
        this.handleOicqMessage(puppetId, e);
      });
      client.on("sync.message", (e) => {
        this.handleSyncedMessage(puppetId, e);
      });
      // FIXME：这个是否真的起作用？
      log.info(`登录Puppet的Remote ID: ${client.uin}`);
      this.bridge.setUserId(puppetId, client.uin.toString());
    } catch (e) {
      log.error(`登录Puppet: ${data.oicqId} 时发生错误 ${e}`);
    }
  }

  public async deletePuppet(puppetId: number) {
    // Puppet实例析构
    const p = this.puppets[puppetId];
    if (!p) {
      return;
    }
    // 登出QQ客户端
    await p.client.logout();
    delete this.puppets[puppetId];
  }

  // 将QQ客户端接收到的消息转发到Matrix
  public async handleOicqMessage(
    puppetId: number,
    e: PrivateMessageEvent | GroupMessageEvent | DiscussMessageEvent
  ) {
    // log.info(`Puppet #${puppetId} 收到消息：`);
    // console.log(e); // FIXME: Log puppet.data.oicqId
    switch (e.message_type) {
      case "private":
        // TODO: 支持QQ Emote、图片和文件
        let privateSendParams = this.getPrivateMessageSendParams(
          puppetId,
          e.friend,
          e.message_id
        );
        // 处理消息
        await parseOicqMessage(
          e.friend,
          e.message,
          this.bridge,
          privateSendParams
        ); // FIXME: 可不可以不传Bridge？
        break;
      case "group":
        let groupSendParams = this.getGroupMessageSendParams(
          puppetId,
          e.group,
          e.member,
          e.message_id
        );
        await parseOicqMessage(
          e.group,
          e.message,
          this.bridge,
          groupSendParams
        );
        break;
      case "discuss":
        // Deprecated: 都2022年了，还在用讨论组，很弱诶
        break;
    }
  }

  // 处理从其他客户端同步过来的消息（Double Puppeting）
  // FIXME: 没有本地SSL环境，这个模块无法测试
  public async handleSyncedMessage(puppetId: number, e: PrivateMessage) {
    let sendParams = this.getSyncedMessageSendParams(
      puppetId,
      e.from_id,
      e.to_id
    );
    await this.bridge.sendMessage(sendParams, { body: e.toString() });
  }

  // 将Matrix接收到的消息送回QQ
  public async handleMatrixMessage(
    room: IRemoteRoom,
    data: IMessageEvent,
    event: any
  ) {
    const p = this.puppets[room.puppetId];
    if (!p) {
      return;
    }
    await this.sendConstructedOicqMessage(p.client, room.roomId, data.body);
  }

  public async handleMatrixImage(
    room: IRemoteRoom,
    data: IFileEvent,
    event: any
  ) {
    const p = this.puppets[room.puppetId];
    if (!p) {
      return;
    }
    // 构造消息体
    const message = [segment.image(data.url)];

    await this.sendConstructedOicqMessage(p.client, room.roomId, message);
  }

  public async sendConstructedOicqMessage(
    client: Client,
    remoteRoomId: string,
    msg: Sendable
  ) {
    const isDirect = isPrivateChat(remoteRoomId);
    if (isDirect) {
      let f = client.pickFriend(getOicqIdFromRoomId(remoteRoomId));
      await f.sendMsg(msg);
    } else {
      let g = client.pickGroup(getOicqIdFromRoomId(remoteRoomId));
      await g.sendMsg(msg);
    }
  }

  public async handleMatrixFile(
    room: IRemoteRoom,
    data: IFileEvent,
    event: any
  ) {
    const p = this.puppets[room.puppetId];
    if (!p) {
      return;
    }

    // 检查是私聊还是群聊，这两个文件处理的方式不一样
    const isDirect = isPrivateChat(room.roomId);
    // 下载临时文件
    const path = await downloadTempFile(data.url, data.filename); // TODO: Exception
    if (isDirect) {
      // 私聊，获取好友对象再发送
      let f = p.client.pickFriend(getOicqIdFromRoomId(room.roomId));
      await f.sendFile(path, data.filename); // TODO: Exception
    } else {
      // 上传群文件
      let g = p.client.pickGroup(getOicqIdFromRoomId(room.roomId));
      await g.fs.upload(path, undefined, data.filename); // TODO: Exception, 指定gfs路径
    }
  }

  public async createRoom(room: IRemoteRoom): Promise<IRemoteRoom | null> {
    // this is called when the puppet bridge wants to create a new room
    // we need to validate that the corresponding roomId exists and, if not return null

    // first we check if the puppet exists
    const p = this.puppets[room.puppetId];
    if (!p) {
      return null;
    }
    // what we need to return is the same filled out information as in getSendParams
    // as our userIds are the same as our roomIds, let's just do that
    return this.getPrivateMessageSendParams(
      room.puppetId,
      p.client.pickFriend(parseInt(room.roomId))
    ).room;
  }

  public async getDmRoomId(user: IRemoteUser): Promise<string | null> {
    // this is called whenever someone invites a ghost on the matrix side
    // from the user ID we need to return the room ID of the DM room, or null if none is present

    // first we check if the puppet exists
    const p = this.puppets[user.puppetId];
    if (!p) {
      return null;
    }

    // now we just return the userId of the ghost
    return user.userId;
  }
}
