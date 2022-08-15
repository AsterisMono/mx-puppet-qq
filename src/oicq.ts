// first we import a few needed things again
import { kMaxLength } from "buffer";
import { time } from "console";
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
  FriendRecallEvent,
  Group,
  GroupMessage,
  GroupMessageEvent,
  Member,
  MessageRet,
  PrivateMessage,
  PrivateMessageEvent,
  segment,
  Sendable,
} from "oicq";
import { parseOicqMessage } from "./message";
import {
  debounce,
  downloadTempFile,
  getOicqIdFromRoomId,
  isPrivateChat,
  makeid,
  timeout,
} from "./utils";

const log = new Log("oicqPuppet:oicq");
const debug = false;
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
      client.on("notice.friend.recall", (e) => {
        this.handleFriendRedactedMessage(puppetId, e);
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
    if (debug) {
      log.info(`Puppet #${puppetId} 收到消息：`);
      console.log(e);
    }
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
        );
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
  // TODO: 没有本地SSL环境，这个模块无法测试
  public async handleSyncedMessage(puppetId: number, e: PrivateMessage) {
    let sendParams = this.getSyncedMessageSendParams(
      puppetId,
      e.from_id,
      e.to_id
    );
    await this.bridge.sendMessage(sendParams, { body: e.toString() }); // TODO: use deliverOicqMessage
  }

  public async handleFriendRedactedMessage(
    puppetId: number,
    e: FriendRecallEvent
  ) {
    if (debug) {
      log.info("收到撤回消息：");
      console.log(e);
    }
    // 获取发送参数
    let sendParams = this.getPrivateMessageSendParams(puppetId, e.friend);
    // 我觉得大家都不喜欢撤回
    // 所以这里使用Reaction做一个记号，就不真撤回了，没必要.jpg
    await this.bridge.sendReaction(sendParams, e.message_id, "撤回"); // FIXME: 使用表情Reaction
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

    const message = data.body;

    this.deliverOicqMessage(room, data.eventId as string, message);
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

    this.deliverOicqMessage(room, data.eventId as string, message);
  }

  // Deliver方法会处理消息发送的全过程（发送、异常处理、事件插入），而不仅是发送本身。
  // 发送方法本体参见sendConstructedOicqMessage。
  public async deliverOicqMessage(
    remoteRoom: IRemoteRoom,
    matrixEventId: string,
    msg: Sendable
  ) {
    const remoteEventId = await this.sendConstructedOicqMessage(
      this.getOicqClientByRoom(remoteRoom),
      remoteRoom.roomId,
      msg
    );
    // 插入事件到存储，方便后续Reply和Reactions
    await this.bridge.eventStore.insert(
      remoteRoom.puppetId,
      remoteRoom.roomId,
      matrixEventId,
      remoteEventId
    );
    if (remoteEventId.startsWith("err")) {
      // 消息发送失败，打个标记
      await this.markMessage(remoteRoom, remoteEventId, "发送失败");
    }
  }

  public async sendConstructedOicqMessage(
    client: Client,
    remoteRoomId: string,
    msg: Sendable
  ): Promise<string> {
    try {
      const isDirect = isPrivateChat(remoteRoomId);
      if (isDirect) {
        let f = client.pickFriend(getOicqIdFromRoomId(remoteRoomId));
        return (await f.sendMsg(msg)).message_id;
      } else {
        let g = client.pickGroup(getOicqIdFromRoomId(remoteRoomId));
        return (await g.sendMsg(msg)).message_id;
      }
    } catch (e) {
      // 由于消息发送失败，没有remoteId可以用
      // 所以生成一个ID供Reaction使用
      return `err${makeid(16)}`;
    }
  }

  public async markMessage(
    room: IRemoteRoom,
    remoteEventId: string,
    reaction: string,
    exclusive = false
  ) {
    if (!remoteEventId) {
      log.error("错误：在处理错误的过程中找不到EventID");
      return;
    }
    const p = this.puppets[room.puppetId];
    if (!p) {
      log.error(
        "发生了了不得的错误！@markMatrixMessageFailedToDeliver:Puppet不存在"
      );
      return;
    }
    // 从room中提取上下文
    const roomId = room.roomId;
    const isDirect = isPrivateChat(roomId);
    if (isDirect) {
      // 是私聊信息，Reaction可以使用对方的身份发送
      const f = p.client.pickFriend(getOicqIdFromRoomId(roomId));
      const sendParams = this.getPrivateMessageSendParams(room.puppetId, f);
      if (exclusive) {
        await this.bridge.removeAllReactions(sendParams, remoteEventId);
      }
      // 需要注意的是！发送Reaction的eventId是RemoteEventId，不是MatrixEventId！！！
      await this.bridge.sendReaction(sendParams, remoteEventId, reaction); // FIXME: 使用表情Reaction
      return;
    } else {
      // 是群聊信息，Reaction可以使用群主身份发送
      const g = p.client.pickGroup(getOicqIdFromRoomId(roomId));
      for (let [k, v] of await g.getMemberMap()) {
        if (g.pickMember(k).is_admin) {
          let groupAdmin = g.pickMember(k);
          const sendParams = this.getGroupMessageSendParams(
            room.puppetId,
            g,
            groupAdmin
          );
          if (exclusive) {
            await this.bridge.removeAllReactions(sendParams, remoteEventId);
          }
          await this.bridge.sendReaction(
            sendParams,
            remoteEventId,
            reaction // FIXME: 使用表情Reaction
          );
          return;
        }
      }
      log.error(`发生了了不得的错误！看起来群${g.group_id}没有群主...`);
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
    // 下载临时文件
    const path = await downloadTempFile(data.url, data.filename);
    this.deliverOicqFile(room, data.eventId as string, path, data.filename);
  }

  public updateFileProgress(
    room: IRemoteRoom,
    remoteEventId: string,
    percentage: string
  ) {
    let reaction = `上传${percentage.split(".")[0]}%`;
    this.markMessage(room, remoteEventId, reaction, true);
  }

  public async deliverOicqFile(
    room: IRemoteRoom,
    matrixEventId: string,
    path: string,
    filename: string
  ) {
    // 生成一个ID（这里提前生成，不使用oicq的文件id，方便进度更新的回调）
    // TODO: 代价是失去了撤回文件的能力！可以设置一个map将此id与file_id对应起来
    const remoteEventId = `pf${makeid(16)}`;

    await this.bridge.eventStore.insert(
      room.puppetId,
      room.roomId,
      matrixEventId,
      remoteEventId
    );
    const progressCb = (percentage: string) => {
      this.updateFileProgress(room, remoteEventId, percentage);
    };
    const debounced = debounce(progressCb, 200);
    const client = this.getOicqClientByRoom(room);

    try {
      if (isPrivateChat(room.roomId)) {
        const f = client.pickFriend(getOicqIdFromRoomId(room.roomId));
        await f.sendFile(path, filename, debounced);
      } else {
        const g = client.pickGroup(getOicqIdFromRoomId(room.roomId));
        await g.fs.upload(path, undefined, filename, debounced);
      }
      timeout(500); // 防止进度标记干扰
      this.markMessage(room, remoteEventId, `发送完毕`, true);
    } catch (e) {
      timeout(500);
      this.markMessage(room, remoteEventId, `发送失败`, true);
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
  // Util
  getOicqClientByRoom(room: IRemoteRoom): Client {
    return this.puppets[room.puppetId]?.client;
  }
  getFriendByRoom(room: IRemoteRoom): Friend | undefined {
    const isDirect = isPrivateChat(room.roomId);
    if (isDirect) {
      return this.getOicqClientByRoom(room).pickFriend(
        getOicqIdFromRoomId(room.roomId)
      );
    } else {
      log.error("对非私聊使用getFriendByRoom");
      return;
    }
  }
}
