import { Route } from '@/types';
import got from '@/utils/got';
import cache from './cache';
import { config } from '@/config';
import utils from './utils';
import ConfigNotFoundError from '@/errors/types/config-not-found';

export const route: Route = {
    path: '/followings/video/:uid/:disableEmbed?',
    categories: ['social-media'],
    example: '/bilibili/followings/video/2267573',
    parameters: { uid: '用户 id', disableEmbed: '默认为开启内嵌视频, 任意值为关闭' },
    features: {
        requireConfig: [
            {
                name: 'BILIBILI_COOKIE_*',
                description: `BILIBILI_COOKIE_28169178: buvid3=669ACB39-495D-8DFC-07D7-50ED809F3F9336951infoc; b_nut=1724080136; _uuid=22C4B194-3D7D-8F10D-B103D-5211349F7106632891infoc; buvid_fp=75c000f1ef5c5627c308f863047b0055; buvid4=C92A63D0-3E18-B0C5-070B-DC496477314B37561-024081915-Wk9U09FdsaYSuZIK1RxlJw%3D%3D; enable_web_push=DISABLE; home_feed_column=5; browser_resolution=1699-933; header_theme_version=CLOSE; CURRENT_FNVAL=4048`,
            ,
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '用户关注视频动态',
    maintainers: ['LogicJake'],
    handler,
    description: `:::warning
  用户动态需要 b 站登录后的 Cookie 值，所以只能自建，详情见部署页面的配置模块。
  :::`,
};

async function handler(ctx) {
    const uid = String(ctx.req.param('uid'));
    const disableEmbed = ctx.req.param('disableEmbed');
    const name = await cache.getUsernameFromUID(uid);

    const cookie = config.bilibili.cookies[uid];
    if (cookie === undefined) {
        throw new ConfigNotFoundError('缺少对应 uid 的 Bilibili 用户登录后的 Cookie 值');
    }

    const response = await got({
        method: 'get',
        url: `https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/dynamic_new?uid=${uid}&type=8`,
        headers: {
            Referer: `https://space.bilibili.com/${uid}/`,
            Cookie: cookie,
        },
    });
    if (response.data.code === -6) {
        throw new ConfigNotFoundError('对应 uid 的 Bilibili 用户的 Cookie 已过期');
    }
    const cards = response.data.data.cards;

    const out = cards.map((card) => {
        const card_data = JSON.parse(card.card);

        return {
            title: card_data.title,
            description: `${card_data.desc}${disableEmbed ? '' : `<br><br>${utils.iframe(card_data.aid)}`}<br><img src="${card_data.pic}">`,
            pubDate: new Date(card_data.pubdate * 1000).toUTCString(),
            link: card_data.pubdate > utils.bvidTime && card_data.bvid ? `https://www.bilibili.com/video/${card_data.bvid}` : `https://www.bilibili.com/video/av${card_data.aid}`,
            author: card.desc.user_profile.info.uname,
        };
    });

    return {
        title: `${name} 关注视频动态`,
        link: `https://t.bilibili.com/?tab=8`,
        item: out,
    };
}
