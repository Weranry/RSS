import { Route } from '@/types';
import got from '@/utils/got';
import cache from './cache';
import { config } from '@/config';
import utils from './utils';
import JSONbig from 'json-bigint';
import { fallback, queryToBoolean } from '@/utils/readable-social';
import querystring from 'querystring';
import ConfigNotFoundError from '@/errors/types/config-not-found';

export const route: Route = {
    path: '/followings/dynamic/:uid/:routeParams?',
    categories: ['social-media'],
    example: '/bilibili/followings/dynamic/109937383',
    parameters: { uid: '用户 id', routeParams: '额外参数；请参阅 [#UP 主动态](#bilibili-up-zhu-dong-tai) 的说明和表格' },
    features: {
        requireConfig: [
            {
                name: 'BILIBILI_COOKIE_*',
                description: 'BILIBILI_COOKIE_28169178: buvid3=669ACB39-495D-8DFC-07D7-50ED809F3F9336951infoc; b_nut=1724080136; _uuid=22C4B194-3D7D-8F10D-B103D-5211349F7106632891infoc; buvid_fp=75c000f1ef5c5627c308f863047b0055; buvid4=C92A63D0-3E18-B0C5-070B-DC496477314B37561-024081915-Wk9U09FdsaYSuZIK1RxlJw%3D%3D; enable_web_push=DISABLE; home_feed_column=5; browser_resolution=1699-933; header_theme_version=CLOSE; CURRENT_FNVAL=4048',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '用户关注动态',
    maintainers: ['TigerCubDen', 'JimenezLi'],
    handler,
    description: `:::warning
  用户动态需要 b 站登录后的 Cookie 值，所以只能自建，详情见部署页面的配置模块。
  :::`,
};

async function handler(ctx) {
    const uid = String(ctx.req.param('uid'));
    const routeParams = querystring.parse(ctx.req.param('routeParams'));

    const showEmoji = fallback(undefined, queryToBoolean(routeParams.showEmoji), false);
    const disableEmbed = fallback(undefined, queryToBoolean(routeParams.disableEmbed), false);
    const displayArticle = fallback(undefined, queryToBoolean(routeParams.displayArticle), false);

    const name = await cache.getUsernameFromUID(uid);
    const cookie = config.bilibili.cookies[uid];
    if (cookie === undefined) {
        throw new ConfigNotFoundError('缺少对应 uid 的 Bilibili 用户登录后的 Cookie 值');
    }

    const response = await got({
        method: 'get',
        url: `https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/dynamic_new?uid=${uid}&type_list=268435455`,
        headers: {
            Referer: `https://space.bilibili.com/${uid}/`,
            Cookie: cookie,
        },
    });
    if (response.data.code === -6) {
        throw new ConfigNotFoundError('对应 uid 的 Bilibili 用户的 Cookie 已过期');
    }
    if (response.data.code === 4_100_000) {
        throw new ConfigNotFoundError('对应 uid 的 Bilibili 用户 请求失败');
    }
    const data = JSONbig.parse(response.body).data.cards;

    const getTitle = (data) => (data ? data.title || data.description || data.content || (data.vest && data.vest.content) || '' : '');
    const getDes = (data) =>
        data.dynamic || data.desc || data.description || data.content || data.summary || (data.vest && data.vest.content) + (data.sketch && `<br>${data.sketch.title}<br>${data.sketch.desc_text}`) || data.intro || '';
    const getOriginDes = (data) => (data && (data.apiSeasonInfo && data.apiSeasonInfo.title && `//转发自: ${data.apiSeasonInfo.title}`) + (data.index_title && `<br>${data.index_title}`)) || '';
    const getOriginName = (data) => data.uname || (data.author && data.author.name) || (data.upper && data.upper.name) || (data.user && (data.user.uname || data.user.name)) || (data.owner && data.owner.name) || '';
    const getOriginTitle = (data) => (data.title ? `${data.title}<br>` : '');
    const getIframe = (data) => (!disableEmbed && data && data.aid ? `<br><br>${utils.iframe(data.aid)}<br>` : '');
    const getImgs = (data) => {
        let imgs = '';
        // 动态图片
        if (data.pictures) {
            for (let i = 0; i < data.pictures.length; i++) {
                imgs += `<img src="${data.pictures[i].img_src}">`;
            }
        }
        // 专栏封面
        if (data.image_urls) {
            for (let i = 0; i < data.image_urls.length; i++) {
                imgs += `<img src="${data.image_urls[i]}">`;
            }
        }
        // 视频封面
        if (data.pic) {
            imgs += `<img src="${data.pic}">`;
        }
        // 音频/番剧/直播间封面/小视频封面
        if (data.cover && data.cover.unclipped) {
            imgs += `<img src="${data.cover.unclipped}">`;
        } else if (data.cover) {
            imgs += `<img src="${data.cover}">`;
        }
        // 专题页封面
        if (data.sketch && data.sketch.cover_url) {
            imgs += `<img src="${data.sketch.cover_url}">`;
        }
        return imgs;
    };

    const items = await Promise.all(
        data.map(async (item) => {
            const parsed = JSONbig.parse(item.card);
            const data = parsed.apiSeasonInfo || (getTitle(parsed.item) ? parsed.item : parsed);
            const origin = parsed.origin ? JSONbig.parse(parsed.origin) : null;

            // img
            let imgHTML = '';

            imgHTML += getImgs(data);

            if (origin) {
                imgHTML += getImgs(origin.item || origin);
            }
            // video小视频
            let videoHTML = '';
            if (data.video_playurl) {
                videoHTML += `<video width="${data.width}" height="${data.height}" controls><source src="${unescape(data.video_playurl).replace(/^http:/, 'https:')}"><source src="${unescape(data.video_playurl)}"></video>`;
            }
            // some rss readers disallow http content.
            // 部分 RSS 阅读器要求内容必须使用https传输
            // bilibili short video does support https request, but https request may timeout ocassionally.
            // to maximize content availability, here add two source tags.
            // bilibili的API中返回的视频地址采用http，然而经验证，短视频地址支持https访问，但偶尔会返回超时错误(可能是网络原因)。
            // 因此保险起见加入两个source标签
            // link
            let link = '';
            if (data.dynamic_id) {
                link = `https://t.bilibili.com/${data.dynamic_id}`;
            } else if (item.desc?.dynamic_id) {
                link = `https://t.bilibili.com/${item.desc.dynamic_id}`;
            }

            // emoji
            let data_content = getDes(data);
            if (item.display && item.display.emoji_info && showEmoji) {
                const emoji = item.display.emoji_info.emoji_details;
                for (const item of emoji) {
                    data_content = data_content.replaceAll(
                        new RegExp(`\\${item.text}`, 'g'),
                        `<img alt="${item.text}" src="${item.url}"style="margin: -1px 1px 0px; display: inline-block; width: 20px; height: 20px; vertical-align: text-bottom;" title="" referrerpolicy="no-referrer">`
                    );
                }
            }
            // 作者信息
            let author = '';
            if (item.desc?.user_profile) {
                author = item.desc.user_profile.info.uname;
            }

            if (data.image_urls && displayArticle) {
                data_content = (await cache.getArticleDataFromCvid(data.id, uid)).description;
            }

            return {
                title: getTitle(data),
                author,
                description: (() => {
                    const description = parsed.new_desc || data_content || getDes(data);
                    const originName = origin && getOriginName(origin) ? `<br><br>//转发自: @${getOriginName(origin)}: ${getOriginTitle(origin.item || origin)}${getDes(origin.item || origin)}` : getOriginDes(origin);
                    const imgHTMLSource = imgHTML ? `<br>${imgHTML}` : '';
                    const videoHTMLSource = videoHTML ? `<br>${videoHTML}` : '';

                    return `${description}${originName}${getIframe(data)}${getIframe(origin)}${imgHTMLSource}${videoHTMLSource}`;
                })(),
                pubDate: new Date(item.desc?.timestamp * 1000).toUTCString(),
                link,
            };
        })
    );

    return {
        title: `${name} 关注的动态`,
        link: `https://t.bilibili.com`,
        description: `${name} 关注的动态`,
        item: items,
    };
}
