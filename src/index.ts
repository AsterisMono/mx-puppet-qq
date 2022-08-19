import {
  PuppetBridge,
  Log,
  IRetData,
  IProtocolInformation,
} from "mx-puppet-bridge";
import * as commandLineArgs from "command-line-args";
import * as commandLineUsage from "command-line-usage";
import { Oicq } from "./oicq";

// 日志模组
const log = new Log("oicqPuppet:index");

// 命令行选项
const commandOptions = [
  { name: "register", alias: "r", type: Boolean },
  { name: "registration-file", alias: "f", type: String },
  { name: "config", alias: "c", type: String },
  { name: "help", alias: "h", type: Boolean },
];
const options = Object.assign(
  {
    register: false,
    "registration-file": "oicq-registration.yaml",
    config: "config.yaml",
    help: false,
  },
  commandLineArgs(commandOptions)
);

if (options.help) {
  // tslint:disable-next-line:no-console
  console.log(
    commandLineUsage([
      {
        header: "Matrix oicq Puppet Bridge",
        content: "A matrix puppet bridge for QQ",
      },
      {
        header: "Options",
        optionList: commandOptions,
      },
    ])
  );
  process.exit(0);
}

// 重要：这里是我们实现协议的定义，包括协议支持的功能、协议ID和仓库URL等
const protocol: IProtocolInformation = {
  features: {
    image: true, // 支持发送图片
    file: true, // 支持发送文件
    audio: true,
    presence: false, // 支持用户在线状态
  },
  id: "oicq", // 协议ID（全小写）
  displayname: "OICQ", // 协议的人类友好名称
  externalUrl: "https://github.com/AsterisMono/mx-puppet-oicq", // 仓库URL
};

// 创建Puppet桥实例
const puppet = new PuppetBridge(
  options["registration-file"],
  options.config,
  protocol
);

// 如果命令行指定了-r,生成Matrix注册文件
if (options.register) {
  puppet.readConfig(false);
  try {
    puppet.generateRegistration({
      prefix: "_qq_",
      id: "oicq-puppet",
      url: `http://${puppet.Config.bridge.bindAddress}:${puppet.Config.bridge.port}`,
    });
  } catch (err) {
    // tslint:disable-next-line:no-console
    console.log("Couldn't generate registration file:", err);
  }
  process.exit(0);
}

async function run() {
  await puppet.init(); // 总是初始化Puppet

  // 创建协议类
  const oicq = new Oicq(puppet);

  // 必选功能：Puppet构造
  puppet.on("puppetNew", oicq.newPuppet.bind(oicq));
  // 必选功能：Puppet析构
  puppet.on("puppetDelete", oicq.deletePuppet.bind(oicq));
  // 必选功能：监听Matrix消息
  puppet.on("message", oicq.handleMatrixMessage.bind(oicq));
  // 可选功能：发送文件
  puppet.on("file", oicq.handleMatrixFile.bind(oicq));
  // 可选功能：发送图片
  puppet.on("image", oicq.handleMatrixImage.bind(oicq));
  // 可选功能：发送语音
  puppet.on("audio", oicq.handleMatrixAudio.bind(oicq));
  // 可选功能：发起会话 (在Matrix一方发起私聊时需要)
  puppet.setCreateRoomHook(oicq.createRoom.bind(oicq));
  // 可选功能: get DM room ID hook (在Matrix一方发起私聊时需要)
  puppet.setGetDmRoomIdHook(oicq.getDmRoomId.bind(oicq));
  // 必选功能：Puppet描述
  puppet.setGetDescHook(
    async (puppetId: number, data: any): Promise<string> => {
      // here we receive the puppet ID and the data associated with that puppet
      // we are expected to return a displayable name for that particular puppet
      return `QQ用户 ${data.oicqId}`;
    }
  );
  // 必选功能：机器人命令（注册Puppet），私聊@_qq_bot:domain.com
  puppet.setGetDataFromStrHook(async (str: string): Promise<IRetData> => {
    if (!str) {
      return {
        success: false,
        error: `使用方法: link <qq号> <连接密码>`,
      };
    }
    log.info(str);
    if (str.startsWith("token")) {
      // Token注册流程
      const [link_token, puppetId, token] = str.split(" ", 2);
      oicq.handleTokenRegister(parseInt(puppetId), token);
    }
    try {
      const [tryLinkId, tryLinkPwd] = str.split(" ", 2);
      if (tryLinkPwd === puppet.config["oicq"][tryLinkId]["link_password"]) {
        return {
          success: true,
          data: {
            oicqId: tryLinkId,
          },
        };
      } else {
        throw new Error("wrong_password");
      }
    } catch (e) {
      return {
        success: false,
        error: "QQ号未正确配置或连接密码不正确！",
      };
    }
  });
  // 必选功能：设置机器人的昵称
  puppet.setBotHeaderMsgHook((): string => {
    return "唐九夏"; // TODO: 加到配置文件里
  });

  // 启动Puppet桥
  await puppet.start();
}

// tslint:disable-next-line:no-floating-promises
run();
