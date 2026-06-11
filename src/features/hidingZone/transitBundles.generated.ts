// GENERATED — regenerate with `pnpm data:transit`
// Do not hand-edit.

import type { Bbox } from "@/shared/geojson";
import type { HidingZonePreset } from "@/features/hidingZone/hidingZoneTypes";

export type TransitBundle = {
    attribution?: unknown;
    presets: HidingZonePreset[];
};

export type TransitBundleMeta = {
    id: string;
    bbox: Bbox;
    file: string;
    presets: { id: string; label: string; bbox: Bbox; kind?: string }[];
};

export type TransitManifest = {
    version: number;
    bundles: TransitBundleMeta[];
};

export const TRANSIT_MANIFEST = {
    version: 1,
    bundles: [
        {
            id: "japan-kanto",
            bbox: [138.4, 34.8, 140.9, 37.1],
            file: "japan-kanto.json",
            presets: [
                {
                    id: "tokyo-metro",
                    label: "Tokyo Metro",
                    bbox: [139.612865, 35.632485, 139.958767, 35.78835],
                    kind: "operator",
                },
                {
                    id: "toei-subway",
                    label: "Toei Subway",
                    bbox: [139.628901, 35.58705, 139.926613, 35.814541],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-other",
                    label: "Other stations in japan-kanto",
                    bbox: [138.4190544, 34.9060338, 140.8402233, 37.0972316],
                    kind: "coverage",
                },
                {
                    id: "osm-japan-kanto-jr-east",
                    label: "JR East",
                    bbox: [138.4094028, 34.8170415, 140.8921829, 37.0947862],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-keikyu",
                    label: "Keikyu",
                    bbox: [139.5803465, 35.1778307, 139.7882659, 35.638715],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-tokyo-metro",
                    label: "Tokyo Metro",
                    bbox: [139.612865, 35.632485, 139.958767, 35.78835],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-tobu-yk3qfz",
                    label: "Tobu",
                    bbox: [139.1939396, 35.644108, 139.999507, 36.8226329],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-opn0a5kf",
                    label: "東京臨海高速鉄道",
                    bbox: [139.7284866, 35.6097199, 139.826605, 35.64578],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-tokyo-waterfront-area-rapid-transit",
                    label: "Tokyo Waterfront Area Rapid Transit",
                    bbox: [139.7284866, 35.6076529, 139.826605, 35.64578],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-sotetsu",
                    label: "Sotetsu",
                    bbox: [139.3894064, 35.3959679, 139.7284866, 35.659097],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1cwatn1",
                    label: "富士急行",
                    bbox: [138.7689798, 35.3075286, 138.9621956, 35.6129342],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1wkrx6f",
                    label: "湘南モノレール",
                    bbox: [139.4877046, 35.3117271, 139.5313546, 35.3523864],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1otocjs",
                    label: "湘南モノレール株式会社",
                    bbox: [139.4875422, 35.3110438, 139.5314325, 35.3543087],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1jhgr94",
                    label: "江ノ島電鉄株式会社",
                    bbox: [139.4826015, 35.3043634, 139.5504286, 35.3397222],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1gzny3d",
                    label: "横浜高速鉄道",
                    bbox: [139.6202973, 35.4421165, 139.6509129, 35.4662066],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-yokohama-municipal-subway",
                    label: "Yokohama Municipal Subway",
                    bbox: [139.4659913, 35.3959679, 139.6468752, 35.5686778],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-tokyu-railways",
                    label: "Tokyu Railways",
                    bbox: [139.4445901, 35.4642692, 139.8335333, 36.7478743],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1b6y1ba",
                    label: "伊豆急行",
                    bbox: [139.0611581, 34.8021874, 139.131082, 34.9755818],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op15thiie",
                    label: "伊豆箱根鉄道",
                    bbox: [138.9114339, 34.9793728, 139.1589825, 35.3191857],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-jr-central",
                    label: "JR Central",
                    bbox: [138.4009535, 34.9755818, 139.7696216, 35.681935],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-opd9tpo2",
                    label: "箱根登山鉄道",
                    bbox: [139.0359155, 35.2345141, 139.1450197, 35.2508461],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-saitama-new-urban-transit-co-ltd",
                    label: "Saitama New Urban Transit Co., Ltd.",
                    bbox: [139.6000557, 35.9063869, 139.6247029, 36.0139563],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-ophlwaxw",
                    label: "野岩鉄道株式会社",
                    bbox: [139.6882913, 36.8528343, 139.7327706, 37.0897835],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-odakyu",
                    label: "Odakyu",
                    bbox: [138.9341778, 35.2556862, 139.701603, 35.692452],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1njuj6",
                    label: "上毛電気鉃道",
                    bbox: [139.0749235, 36.294102, 139.3787733, 36.4257745],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op13g3417",
                    label: "しなの鉄道",
                    bbox: [138.4217128, 36.3086281, 138.6351092, 36.3475761],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-keio-yjwknh",
                    label: "Keio",
                    bbox: [139.2699078, 35.5948686, 139.702673, 35.7031413],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-opo9a1xm",
                    label: "多摩都市モノレール",
                    bbox: [139.4037336, 35.6239385, 139.4228734, 35.7458813],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-tokyo-tama-intercity-monorail-co-ltd",
                    label: "Tokyo Tama Intercity Monorail Co., Ltd.",
                    bbox: [139.4037336, 35.6239385, 139.4228734, 35.7458813],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-seibu",
                    label: "Seibu",
                    bbox: [139.083122, 35.6537483, 139.7954103, 35.9902119],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-opcxuxmo",
                    label: "横浜シーサイドライン",
                    bbox: [139.6195735, 35.3305191, 139.6501527, 35.386554],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-keisei",
                    label: "Keisei",
                    bbox: [139.7380078, 35.5338295, 140.3872193, 35.8036457],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1nl80rb",
                    label: "埼玉新都市交通",
                    bbox: [139.6000557, 35.9205193, 139.6247029, 36.0139563],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1yimp92",
                    label: "池袋線系統",
                    bbox: [139.083122, 35.9084908, 139.2267337, 35.9925066],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1hloyvv",
                    label: "秩父鉄道",
                    bbox: [139.2480617, 36.1308138, 139.4684922, 36.1472311],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-opjcjba",
                    label: "高尾登山電鉄",
                    bbox: [139.2576432, 35.6311026, 139.2699078, 35.6325002],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-opjn4jp0",
                    label: "株式会社ゆりかもめ",
                    bbox: [139.7577718, 35.6175656, 139.7954103, 35.665386],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1h2uedp",
                    label: "真岡鐵道",
                    bbox: [139.9704471, 36.3041716, 140.1814246, 36.5381552],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-opjidua3",
                    label: "舞浜リゾートライン",
                    bbox: [139.8763686, 35.626147, 139.8895705, 35.636259],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op13s38t",
                    label: "東葉高速鉄道",
                    bbox: [139.958767, 35.7059603, 140.1260561, 35.7288504],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-seibu-railway-company-ltd",
                    label: "Seibu Railway Company, Ltd.",
                    bbox: [139.4197824, 35.7660664, 139.4426285, 35.7704505],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op426lm",
                    label: "流鉄",
                    bbox: [139.9010892, 35.8265973, 139.9198204, 35.8558741],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op132bgqg",
                    label: "いすみ鉄道",
                    bbox: [140.1999004, 35.2406328, 140.3909878, 35.2916957],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1d1j8yd",
                    label: "小湊鉄道",
                    bbox: [140.1002691, 35.250069, 140.1999004, 35.4962381],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1d1jlly",
                    label: "小湊鐵道",
                    bbox: [140.0895617, 35.250069, 140.1999004, 35.5130963],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1c0cd2l",
                    label: "首都圏新都市鉄道",
                    bbox: [139.775529, 35.697965, 140.1111943, 36.0826496],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1iw4w84",
                    label: "千葉都市モノレール株式会社",
                    bbox: [140.1024718, 35.6036854, 140.1885502, 35.6432352],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1j8n783",
                    label: "千葉都市モノレール",
                    bbox: [140.1024718, 35.6072241, 140.1885502, 35.6432352],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1hdyyo5",
                    label: "東京モノレール",
                    bbox: [139.7470566, 35.5428212, 139.7882659, 35.6227359],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1bqzh7m",
                    label: "北総鉄道",
                    bbox: [139.8671221, 35.7509396, 140.2031172, 35.8036457],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1j3jlzs",
                    label: "埼玉高速鉄道",
                    bbox: [139.7276313, 35.8001212, 139.7537018, 35.8938207],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-toei-yk3qie",
                    label: "Toei",
                    bbox: [139.553079, 35.58705, 139.926613, 35.814541],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op14dfdqb",
                    label: "ゆりかもめ",
                    bbox: [139.7577718, 35.6175656, 139.7954103, 35.665386],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1er6ldu",
                    label: "東武本線",
                    bbox: [139.3787733, 36.2465491, 139.6093007, 36.3981905],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1gxhyey",
                    label: "富士山麓電気鉄道株式会社",
                    bbox: [138.7819442, 35.4893684, 138.942183, 35.6129342],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1nx68xi",
                    label: "ひたちなか海浜鉄道",
                    bbox: [140.5242433, 36.3450819, 140.6179632, 36.3944346],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1arpyj3",
                    label: "上信電鉄",
                    bbox: [138.8919038, 36.2604237, 139.0381956, 36.3123827],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op3yrj1",
                    label: "山万",
                    bbox: [140.1483869, 35.7259449, 140.1552553, 35.7402153],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-opt2g1wu",
                    label: "山万株式会社",
                    bbox: [140.1483869, 35.7217309, 140.1563758, 35.7402153],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op3wh6k",
                    label: "京王",
                    bbox: [139.6672321, 35.6736801, 139.6862442, 35.6811565],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op1l00vtz",
                    label: "江ノ島電鉄",
                    bbox: [139.4826015, 35.3043634, 139.5455001, 35.3321271],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op49hnb",
                    label: "長電",
                    bbox: [138.4032901, 36.7417299, 138.4146144, 36.7599683],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto-op10kps7s",
                    label: "東京メトロ",
                    bbox: [139.6894, 35.738175, 139.737362, 35.75447],
                    kind: "operator",
                },
            ],
        },
        {
            id: "japan-kansai",
            bbox: [134.5, 33.5, 136.5, 35.8],
            file: "japan-kansai.json",
            presets: [
                {
                    id: "osm-japan-kansai-other",
                    label: "Other stations in japan-kansai",
                    bbox: [134.5022692, 33.5010952, 136.4995209, 35.7735746],
                    kind: "coverage",
                },
                {
                    id: "osm-japan-kansai-opivr2z",
                    label: "四国旅客鉄道",
                    bbox: [134.5281015, 33.7290455, 134.6672263, 34.1788965],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-kintetsu",
                    label: "Kintetsu",
                    bbox: [135.4953257, 34.3770064, 136.4988331, 35.1699835],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-jr-central",
                    label: "JR Central",
                    bbox: [135.1956157, 34.1119898, 136.492566, 35.3638665],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-jr-west",
                    label: "JR West",
                    bbox: [134.5224649, 33.6440079, 136.4503325, 35.6499609],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-jr-east",
                    label: "JR East",
                    bbox: [135.1755908, 34.6790031, 136.470574, 35.644899],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-opmxri",
                    label: "京都市交通局",
                    bbox: [135.7150576, 34.9332242, 135.8172365, 35.062913],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1hz8ohm",
                    label: "紀州鉄道",
                    bbox: [135.1530092, 33.8867947, 135.1591382, 33.907868],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-nankai",
                    label: "Nankai",
                    bbox: [135.080825, 34.2170732, 135.6148285, 34.6679549],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-hanshin",
                    label: "Hanshin",
                    bbox: [135.1441617, 34.6624401, 135.8285414, 34.7368439],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-keihan",
                    label: "Keihan",
                    bbox: [135.4867814, 34.6687161, 135.9033943, 35.0704684],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1fohg9v",
                    label: "水間鉄道",
                    bbox: [135.3575766, 34.4033394, 135.3855272, 34.4455195],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1vc0uv8",
                    label: "大阪高速鉄道",
                    bbox: [135.4420026, 34.7373123, 135.5825631, 34.8346327],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op15bpsvt",
                    label: "大阪モノレール",
                    bbox: [135.4420026, 34.7373123, 135.5825631, 34.8552624],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-hankyu",
                    label: "Hankyu",
                    bbox: [135.1441617, 34.6624401, 135.7485884, 35.0100353],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1bpsjyu",
                    label: "叡山電鉄",
                    bbox: [135.7630053, 35.0304955, 135.8084891, 35.112896],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op9mj5uv",
                    label: "叡山電鉄株式会社",
                    bbox: [135.7732355, 35.0304955, 135.8086639, 35.0669237],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-opypewqo",
                    label: "大阪市高速電気軌道",
                    bbox: [135.4121458, 34.5563044, 135.5931109, 34.7600025],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op88lub",
                    label: "泉北高速鉄道",
                    bbox: [135.4562898, 34.4613227, 135.5116636, 34.5563044],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1bn9gc4",
                    label: "北条鉄道",
                    bbox: [134.8251219, 34.8621055, 134.8779303, 34.9294625],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-opkfaty3",
                    label: "神戸市交通局",
                    bbox: [135.0174576, 34.6517099, 135.195996, 34.7618497],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1wq43ai",
                    label: "京都丹後鉄道",
                    bbox: [134.8133194, 35.2960352, 135.2935928, 35.6673605],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-willer-trains",
                    label: "WILLER TRAINS",
                    bbox: [134.8133194, 35.4462963, 135.2935928, 35.6673605],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1mrqlyh",
                    label: "神戸新交通",
                    bbox: [135.2022901, 34.6372668, 135.2701132, 34.71949],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1hg37ju",
                    label: "神戸電鉄",
                    bbox: [134.9094873, 34.6763214, 135.2462748, 34.909716],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1kwpnu4",
                    label: "近江鉄道",
                    bbox: [136.1027652, 34.9522655, 136.2901179, 35.3149074],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-ophb4sse",
                    label: "和歌山電鐵",
                    bbox: [135.19158, 34.203393, 135.3120093, 34.2322107],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-kintetsu-corporation",
                    label: "Kintetsu Corporation",
                    bbox: [135.6193261, 34.586798, 135.6892136, 34.6861028],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1y4sr0n",
                    label: "関西国際空港",
                    bbox: [135.2386118, 34.4302084, 135.2511296, 34.4386194],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op18xct0c",
                    label: "山陽電気鉄道",
                    bbox: [134.5883518, 34.6292608, 135.1441617, 34.8030657],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-opx8u9zd",
                    label: "京福電気鉄道",
                    bbox: [135.677996, 35.0032482, 135.8638503, 35.0696684],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op188x4cd",
                    label: "嵯峨野観光鉄道",
                    bbox: [135.6702405, 35.0164451, 135.6814425, 35.0187788],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1ijac83",
                    label: "能勢電鉄",
                    bbox: [135.4124922, 34.8688085, 135.4448142, 34.9115905],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op3szbjz",
                    label: "能勢電",
                    bbox: [135.3930797, 34.8275522, 135.4448142, 34.9115905],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1qdsgze",
                    label: "阪堺電気軌道",
                    bbox: [135.4912329, 34.6126618, 135.5032542, 34.6493423],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1ats42d",
                    label: "三岐鉄道",
                    bbox: [136.4784524, 35.1474693, 136.4988331, 35.1699835],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op1bpn45m",
                    label: "南海鉄道",
                    bbox: [135.6001349, 34.3378833, 135.6033421, 34.3661019],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-op4jx47f",
                    label: "高松琴平電気鉄道",
                    bbox: [134.5070405, 34.0746743, 134.5513898, 34.155322],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kansai-opmima1q",
                    label: "日本貨物鉄道",
                    bbox: [135.1334698, 34.6510241, 135.5645484, 34.7726284],
                    kind: "operator",
                },
            ],
        },
        {
            id: "japan-chubu",
            bbox: [136.2, 34.6, 138.6, 37.8],
            file: "japan-chubu.json",
            presets: [
                {
                    id: "osm-japan-chubu-other",
                    label: "Other stations in japan-chubu",
                    bbox: [136.2024226, 34.6146895, 138.5963107, 37.3994105],
                    kind: "coverage",
                },
                {
                    id: "osm-japan-chubu-jr-east",
                    label: "JR East",
                    bbox: [136.2017231, 34.6857162, 138.5992422, 37.3633912],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op13g3417",
                    label: "しなの鉄道",
                    bbox: [138.1281001, 36.3086281, 138.5925183, 36.8722009],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-jr-central",
                    label: "JR Central",
                    bbox: [136.2901179, 34.6857162, 138.5893576, 36.6431239],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op49hnb",
                    label: "長電",
                    bbox: [138.1885153, 36.6427727, 138.4146144, 36.7610739],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-kintetsu",
                    label: "Kintetsu",
                    bbox: [136.2047571, 34.6352912, 136.884857, 35.1707285],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-jr-west",
                    label: "JR West",
                    bbox: [136.2066992, 34.8210883, 138.2486852, 37.0812219],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op1kwpnu4",
                    label: "近江鉄道",
                    bbox: [136.2057039, 35.0122637, 136.2901179, 35.3149074],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op1ats42d",
                    label: "三岐鉄道",
                    bbox: [136.4784524, 35.0223165, 136.6841175, 35.1699835],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-opcuedkk",
                    label: "えちぜん鉄道",
                    bbox: [136.2060103, 36.0621497, 136.2239821, 36.0863414],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-optpufp8",
                    label: "えちごトキめき鉄道",
                    bbox: [137.7382109, 36.8722009, 138.2576562, 37.170264],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-meitetsu",
                    label: "Meitetsu",
                    bbox: [136.6860366, 34.7447087, 137.3968532, 36.7017575],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-opw15mch",
                    label: "名古屋市交通局",
                    bbox: [136.8532274, 35.0973085, 137.0134764, 35.1928428],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op1kd1pdd",
                    label: "豊橋鉄道",
                    bbox: [137.2690362, 34.666858, 137.3885681, 34.7630551],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op1zb3r6",
                    label: "あいの風とやま鉄道",
                    bbox: [136.7916218, 36.672509, 137.5987426, 36.9737486],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-ir-183xy7g",
                    label: "IRいしかわ鉄道",
                    bbox: [136.4595421, 36.4518274, 136.7916218, 36.672509],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op1r4ve4i",
                    label: "富山地方鉄道",
                    bbox: [137.223568, 36.6916369, 137.4810621, 36.8747257],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op2todam",
                    label: "名古屋臨海高速鉄道",
                    bbox: [136.849133, 35.0488985, 136.884857, 35.1707285],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op1bv2tvv",
                    label: "北陸鉄道",
                    bbox: [136.6114683, 36.4522166, 136.6443889, 36.5539047],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-opqu1eos",
                    label: "北陸鉄道株式会社",
                    bbox: [136.6114683, 36.4522166, 136.6517842, 36.6334313],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op1mehjmv",
                    label: "養老鉄道",
                    bbox: [136.556809, 35.0781729, 136.674788, 35.4703264],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op1qnqusf",
                    label: "長良川鉄道",
                    bbox: [136.8298041, 35.4498526, 137.00146, 35.9304277],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op1elvq4v",
                    label: "明知鉄道",
                    bbox: [137.3874775, 35.3061728, 137.4611046, 35.4552746],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-opjn4s9u",
                    label: "愛知環状鉄道",
                    bbox: [137.0435945, 34.9255832, 137.1626115, 35.2643049],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op102ixdy",
                    label: "大井川鐵道",
                    bbox: [138.0777722, 34.8196538, 138.2213164, 35.2124343],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-opgzf65f",
                    label: "東海交通事業",
                    bbox: [136.8550037, 35.1994691, 136.9520547, 35.2294678],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op148fk2z",
                    label: "愛知高速交通株式会社",
                    bbox: [137.0213902, 35.1715632, 137.0971586, 35.1825127],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chubu-op1kxd55m",
                    label: "遠州鉄道",
                    bbox: [137.7324983, 34.703629, 137.8011445, 34.8344623],
                    kind: "operator",
                },
            ],
        },
        {
            id: "japan-tohoku",
            bbox: [139.5, 36.9, 142, 41.6],
            file: "japan-tohoku.json",
            presets: [
                {
                    id: "osm-japan-tohoku-other",
                    label: "Other stations in japan-tohoku",
                    bbox: [139.5175571, 37.0132631, 141.958733, 41.4422046],
                    kind: "coverage",
                },
                {
                    id: "osm-japan-tohoku-jr-east",
                    label: "JR East",
                    bbox: [139.5181639, 36.9047863, 141.8724537, 41.1854265],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-ophlwaxw",
                    label: "野岩鉄道株式会社",
                    bbox: [139.6882913, 36.9295029, 139.7275289, 37.0897835],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op1b2dh3v",
                    label: "会津鉄道",
                    bbox: [139.7050278, 37.0897835, 139.9322392, 37.4859472],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op1hfwfag",
                    label: "福島交通",
                    bbox: [140.4396862, 37.75454, 140.4594125, 37.8298669],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op1rbxu03",
                    label: "阿武隈急行",
                    bbox: [140.4592144, 37.75454, 140.8100456, 38.0786802],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-jr-47hatf",
                    label: "JR東北線",
                    bbox: [140.1884461, 37.1230906, 140.4842295, 37.75454],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op1b3e4cd",
                    label: "三陸鉄道",
                    bbox: [141.7106981, 39.0542007, 141.9739513, 40.1902903],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op1niweyo",
                    label: "青い森鉄道",
                    bbox: [140.7341384, 40.1902903, 141.7922251, 41.2829772],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op10cavr9",
                    label: "アイジーアールいわて銀河鉄道線",
                    bbox: [140.5546859, 39.7005875, 141.2172841, 40.266195],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op1d15nwv",
                    label: "山形鉄道",
                    bbox: [140.0297508, 38.0477732, 140.1491345, 38.1879827],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op1ddopfv",
                    label: "弘南鉄道",
                    bbox: [140.4681793, 40.5218329, 140.5917659, 40.6491481],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op1lwyzl1",
                    label: "秋田内陸縦貫鉄道",
                    bbox: [140.3304322, 39.6273176, 140.6027289, 40.2246416],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op12j1rpp",
                    label: "由利高原鉄道",
                    bbox: [140.0487059, 39.2303757, 140.1387548, 39.3868119],
                    kind: "operator",
                },
                {
                    id: "osm-japan-tohoku-op6qh9ny",
                    label: "仙台市交通局",
                    bbox: [140.8353433, 38.2144503, 140.9484215, 38.3232105],
                    kind: "operator",
                },
            ],
        },
        {
            id: "japan-chugoku",
            bbox: [130.7, 33.3, 134.5, 36],
            file: "japan-chugoku.json",
            presets: [
                {
                    id: "osm-japan-chugoku-other",
                    label: "Other stations in japan-chugoku",
                    bbox: [130.8146156, 33.3053086, 134.468702, 35.6195566],
                    kind: "coverage",
                },
                {
                    id: "osm-japan-chugoku-opivr2z",
                    label: "四国旅客鉄道",
                    bbox: [132.4359975, 33.3290402, 134.4850963, 34.6654089],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-op1awy86m",
                    label: "伊予鉄道",
                    bbox: [132.702036, 33.7554599, 132.8842865, 33.8834303],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-op1clvlry",
                    label: "九州旅客鉄道",
                    bbox: [130.7021869, 33.3056846, 131.575572, 33.9154455],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-jr-yk9zjw",
                    label: "JR九州",
                    bbox: [130.8644088, 33.7287056, 130.978792, 33.8886007],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-jr-west",
                    label: "JR West",
                    bbox: [130.882509, 33.5672072, 134.4943513, 35.6208056],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-kitakyushu-urban-monorail",
                    label: "Kitakyushu Urban Monorail",
                    bbox: [130.863746, 33.8196416, 130.882509, 33.8868464],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-op4jx47f",
                    label: "高松琴平電気鉄道",
                    bbox: [133.757012, 34.1173923, 134.4837411, 34.3507278],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-opkfiahx",
                    label: "水島臨海鉄道",
                    bbox: [133.7331149, 34.5229584, 133.7657825, 34.6019504],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-op1axpxrv",
                    label: "一畑電車",
                    bbox: [132.6872506, 35.3692038, 133.0038431, 35.4809028],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-op1avair4",
                    label: "井原鉄道",
                    bbox: [133.3869653, 34.552927, 133.4333612, 34.5818061],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-op1etaon1",
                    label: "智頭急行",
                    bbox: [134.2891718, 34.8660634, 134.353484, 35.2323406],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-op1u7makp",
                    label: "筑豊電気鉄道",
                    bbox: [130.7115356, 33.7535355, 130.7662431, 33.8670036],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-opcwafrj",
                    label: "九州旅客鉄道株式会社",
                    bbox: [130.7122632, 33.8642177, 130.9625874, 33.9460196],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-jr-kyushu",
                    label: "JR Kyushu",
                    bbox: [130.882509, 33.8868464, 130.9329208, 33.9505246],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-hiroshima-rapid-transit",
                    label: "Hiroshima Rapid Transit",
                    bbox: [132.4001446, 34.3931587, 132.4773247, 34.4757349],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-jr-central",
                    label: "JR Central",
                    bbox: [130.882509, 33.8868464, 133.917825, 34.6654089],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-op13a8rsq",
                    label: "平成筑豊鉄道",
                    bbox: [130.724536, 33.612601, 130.9737368, 33.9606998],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-op1ix9osd",
                    label: "若桜鉄道",
                    bbox: [134.2463154, 35.3451861, 134.398414, 35.4132408],
                    kind: "operator",
                },
                {
                    id: "osm-japan-chugoku-op1dc4ail",
                    label: "広島電鉄",
                    bbox: [132.3049223, 34.3117771, 132.304935, 34.3143211],
                    kind: "operator",
                },
            ],
        },
        {
            id: "japan-kyushu",
            bbox: [129.3, 30.9, 132.5, 34.2],
            file: "japan-kyushu.json",
            presets: [
                {
                    id: "osm-japan-kyushu-other",
                    label: "Other stations in japan-kyushu",
                    bbox: [129.5827639, 31.2048735, 132.4791606, 34.1939059],
                    kind: "coverage",
                },
                {
                    id: "osm-japan-kyushu-op1clvlry",
                    label: "九州旅客鉄道",
                    bbox: [129.7260999, 31.1903006, 131.9192001, 33.9154455],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-jr-yk9zjw",
                    label: "JR九州",
                    bbox: [129.9462376, 32.9780626, 130.978792, 33.8886007],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-jr-west",
                    label: "JR West",
                    bbox: [130.4197831, 31.5834284, 132.2255418, 34.1726099],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-kitakyushu-urban-monorail",
                    label: "Kitakyushu Urban Monorail",
                    bbox: [130.863746, 33.8196416, 130.882509, 33.8868464],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-op1u7makp",
                    label: "筑豊電気鉄道",
                    bbox: [130.7115356, 33.7535355, 130.7662431, 33.8670036],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-opcwafrj",
                    label: "九州旅客鉄道株式会社",
                    bbox: [129.852916, 32.5898056, 131.9192001, 33.9460196],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-jr-kyushu",
                    label: "JR Kyushu",
                    bbox: [129.7260999, 31.8724607, 131.6060258, 33.9505246],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-jr-central",
                    label: "JR Central",
                    bbox: [130.4197831, 33.5900436, 130.882509, 33.8868464],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-op13a8rsq",
                    label: "平成筑豊鉄道",
                    bbox: [130.724536, 33.612601, 130.9737368, 33.9606998],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-opivr2z",
                    label: "四国旅客鉄道",
                    bbox: [132.4359975, 33.3914382, 132.4990151, 33.6152965],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-op13iendy",
                    label: "くま川鉄道",
                    bbox: [130.7538443, 32.2023276, 130.979927, 32.281475],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-op1xap2cs",
                    label: "西日本鉄道",
                    bbox: [130.3994222, 33.0299039, 130.6532751, 33.5892548],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-opo2mnkl",
                    label: "福岡市交通局",
                    bbox: [130.3210647, 33.5457836, 130.448182, 33.6320356],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-opc5trp9",
                    label: "西日本鉄道株式会社",
                    bbox: [130.4225598, 33.6320356, 130.4441037, 33.7141282],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-op1es0gn4",
                    label: "松浦鉄道",
                    bbox: [129.6572562, 33.1894176, 129.7903672, 33.3441797],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-opzlzcn8",
                    label: "熊本電気鉄道",
                    bbox: [130.7018919, 32.808672, 130.7498792, 32.8831578],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-ophz32rd",
                    label: "南阿蘇鉄道",
                    bbox: [131.0039609, 32.8175191, 131.1225347, 32.8541971],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-op1c5qht7",
                    label: "肥薩おれんじ鉄道",
                    bbox: [130.1963782, 31.8137835, 130.6217417, 32.504005],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kyushu-op3rsdmf",
                    label: "福岡市",
                    bbox: [130.313949, 33.6042012, 130.4198606, 33.662151],
                    kind: "operator",
                },
            ],
        },
        {
            id: "japan-shikoku",
            bbox: [131.9, 32.5, 134.8, 34.5],
            file: "japan-shikoku.json",
            presets: [
                {
                    id: "osm-japan-shikoku-other",
                    label: "Other stations in japan-shikoku",
                    bbox: [131.919179, 32.9206771, 134.6480271, 34.4993068],
                    kind: "coverage",
                },
                {
                    id: "osm-japan-shikoku-opivr2z",
                    label: "四国旅客鉄道",
                    bbox: [132.4359975, 33.1755516, 134.6672263, 34.4627408],
                    kind: "operator",
                },
                {
                    id: "osm-japan-shikoku-op4jx47f",
                    label: "高松琴平電気鉄道",
                    bbox: [133.757012, 34.0746743, 134.5513898, 34.3507278],
                    kind: "operator",
                },
                {
                    id: "osm-japan-shikoku-jr-west",
                    label: "JR West",
                    bbox: [131.9146925, 33.5672072, 134.5513898, 34.4983105],
                    kind: "operator",
                },
                {
                    id: "osm-japan-shikoku-op1awy86m",
                    label: "伊予鉄道",
                    bbox: [132.702036, 33.7554599, 132.8842865, 33.8834303],
                    kind: "operator",
                },
                {
                    id: "osm-japan-shikoku-hiroshima-rapid-transit",
                    label: "Hiroshima Rapid Transit",
                    bbox: [132.4001446, 34.3931587, 132.4773247, 34.4757349],
                    kind: "operator",
                },
                {
                    id: "osm-japan-shikoku-jr-central",
                    label: "JR Central",
                    bbox: [132.4753527, 34.3985139, 133.3618898, 34.4892799],
                    kind: "operator",
                },
                {
                    id: "osm-japan-shikoku-op1dc4ail",
                    label: "広島電鉄",
                    bbox: [132.3049223, 34.3117771, 132.304935, 34.3143211],
                    kind: "operator",
                },
                {
                    id: "osm-japan-shikoku-op1clvlry",
                    label: "九州旅客鉄道",
                    bbox: [131.9018836, 32.9724755, 131.9192001, 33.0660414],
                    kind: "operator",
                },
                {
                    id: "osm-japan-shikoku-opcwafrj",
                    label: "九州旅客鉄道株式会社",
                    bbox: [131.9018836, 32.9724755, 131.9192001, 33.0660414],
                    kind: "operator",
                },
                {
                    id: "osm-japan-shikoku-op1wrarzc",
                    label: "土佐くろしお鉄道",
                    bbox: [132.713119, 32.9325416, 133.1162041, 33.1880575],
                    kind: "operator",
                },
            ],
        },
        {
            id: "japan-hokkaido",
            bbox: [139.5, 41.3, 146, 45.7],
            file: "japan-hokkaido.json",
            presets: [
                {
                    id: "osm-japan-hokkaido-other",
                    label: "Other stations in japan-hokkaido",
                    bbox: [139.875745, 41.402265, 144.6614523, 45.2592524],
                    kind: "coverage",
                },
                {
                    id: "osm-japan-hokkaido-op1n29wec",
                    label: "北海道旅客鉄道",
                    bbox: [140.2732585, 41.6785581, 145.5828156, 45.4166166],
                    kind: "operator",
                },
                {
                    id: "osm-japan-hokkaido-op10l6bp8",
                    label: "道南いさりび鉄道",
                    bbox: [140.4679191, 41.6991942, 140.7336432, 41.8266409],
                    kind: "operator",
                },
                {
                    id: "osm-japan-hokkaido-op14x7k2m",
                    label: "札幌市交通局",
                    bbox: [141.2757283, 42.991171, 141.4739808, 43.1130049],
                    kind: "operator",
                },
                {
                    id: "osm-japan-hokkaido-op1jg4qei",
                    label: "北海道中央バス",
                    bbox: [141.6770206, 43.1429754, 141.9299527, 43.5296028],
                    kind: "operator",
                },
                {
                    id: "osm-japan-hokkaido-op1hpqm7v",
                    label: "空知鉄道",
                    bbox: [141.7059485, 43.2522774, 141.7061728, 43.2525144],
                    kind: "operator",
                },
            ],
        },
    ],
} as TransitManifest;

export const transitBundleLoaders: Record<
    string,
    () => Promise<TransitBundle>
> = {
    "japan-kanto": () =>
        import("../../../assets/transit/japan-kanto.json").then(
            (m) =>
                ((m as Record<string, unknown>).default ?? m) as TransitBundle,
        ),
    "japan-kansai": () =>
        import("../../../assets/transit/japan-kansai.json").then(
            (m) =>
                ((m as Record<string, unknown>).default ?? m) as TransitBundle,
        ),
    "japan-chubu": () =>
        import("../../../assets/transit/japan-chubu.json").then(
            (m) =>
                ((m as Record<string, unknown>).default ?? m) as TransitBundle,
        ),
    "japan-tohoku": () =>
        import("../../../assets/transit/japan-tohoku.json").then(
            (m) =>
                ((m as Record<string, unknown>).default ?? m) as TransitBundle,
        ),
    "japan-chugoku": () =>
        import("../../../assets/transit/japan-chugoku.json").then(
            (m) =>
                ((m as Record<string, unknown>).default ?? m) as TransitBundle,
        ),
    "japan-kyushu": () =>
        import("../../../assets/transit/japan-kyushu.json").then(
            (m) =>
                ((m as Record<string, unknown>).default ?? m) as TransitBundle,
        ),
    "japan-shikoku": () =>
        import("../../../assets/transit/japan-shikoku.json").then(
            (m) =>
                ((m as Record<string, unknown>).default ?? m) as TransitBundle,
        ),
    "japan-hokkaido": () =>
        import("../../../assets/transit/japan-hokkaido.json").then(
            (m) =>
                ((m as Record<string, unknown>).default ?? m) as TransitBundle,
        ),
};
