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
} from "oicq";

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
        // roomId: 远端房间ID，这里是私聊，直接使用QQ号
        // FIXME：会不会存在QQ号和群号重复的情况？
        puppetId,
        roomId: friend.user_id.toString(),
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
        roomId: group.group_id.toString(),
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
    log.info(`Puppet #${puppetId} 收到消息：${e}`); // FIXME: Log puppet.data.oicqId
    switch (e.message_type) {
      case "private":
        // TODO: 支持QQ Emote、图片和文件
        let privateSendParams = this.getPrivateMessageSendParams(
          puppetId,
          e.friend,
          e.message_id
        );
        await this.bridge.sendMessage(privateSendParams, {
          body: e.toString(),
        });
        break;
      case "group":
        let groupSendParams = this.getGroupMessageSendParams(
          puppetId,
          e.group,
          e.member,
          e.message_id
        );
        await this.bridge.sendMessage(groupSendParams, { body: e.toString() });
        break;
      case "discuss":
        // Deprecated: 都2022年了，还在用讨论组，很弱诶
        break;
    }
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
    // 获取好友
    let f = p.client.pickFriend(parseInt(room.roomId));
    // 发送消息并处理异常情况
    // TODO: Handle Exceptions
    await f.sendMsg(data.body);
  }

  public async handleMatrixFile(
    room: IRemoteRoom,
    data: IFileEvent,
    event: any
  ) {
    // this is called every time we receive a file from matrix, as we enabled said feature

    // first we check if the puppet exists
    const p = this.puppets[room.puppetId];
    if (!p) {
      return;
    }
    // usually you'd send it here to the remote protocol via the client object
    // p.client.sendFile(room.roomId, data.url);
    // we just echo this back
    // const params = this.getSendParams(room.puppetId, room.roomId);
    // await this.bridge.sendFileDetect(params, data.url, data.filename);
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
