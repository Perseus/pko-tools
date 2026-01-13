use binrw::{binrw, BinRead};

#[repr(u32)]
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
#[binrw]
#[br(repr = u32)]
#[bw(repr = u32)]
pub enum D3DFormat {
    Unknown = 0,

    R8G8B8 = 20,
    A8R8G8B8 = 21,
    X8R8G8B8 = 22,
    R5G6B5 = 23,
    X1R5G5B5 = 24,
    A1R5G5B5 = 25,
    A4R4G4B4 = 26,
    R3G3B2 = 27,
    A8 = 28,
    A8R3G3B2 = 29,
    X4R4G4B4 = 30,
    A2B10G10R10 = 31,
    G16R16 = 34,

    A8P8 = 40,
    P8 = 41,

    L8 = 50,
    A8L8 = 51,
    A4L4 = 52,

    V8U8 = 60,
    L6V5U5 = 61,
    X8L8V8U8 = 62,
    Q8W8V8U8 = 63,
    V16U16 = 64,
    W11V11U10 = 65,
    A2W10V10U10 = 67,

    UYVY = 0x59565955, // MAKEFOURCC('U', 'Y', 'V', 'Y')
    YUY2 = 0x32595559, // MAKEFOURCC('Y', 'U', 'Y', '2')
    DXT1 = 0x31545844, // MAKEFOURCC('D', 'X', 'T', '1')
    DXT2 = 0x32545844, // MAKEFOURCC('D', 'X', 'T', '2')
    DXT3 = 0x33545844, // MAKEFOURCC('D', 'X', 'T', '3')
    DXT4 = 0x34545844, // MAKEFOURCC('D', 'X', 'T', '4')
    DXT5 = 0x35545844, // MAKEFOURCC('D', 'X', 'T', '5')

    D16Lockable = 70,
    D32 = 71,
    D15S1 = 73,
    D24S8 = 75,
    D16 = 80,
    D24X8 = 77,
    D24X4S4 = 79,

    VertexData = 100,
    Index16 = 101,
    Index32 = 102,

    InvalidMax = 0xffffffff,
}

#[repr(u32)]
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
#[binrw]
#[br(repr = u32)]
#[bw(repr = u32)]
pub enum D3DPool {
    // stored in GPU memory
    // can be accessed only by the GPU
    Default = 0,

    // stored in system memory, copied to GPU memory when needed
    // can be accessed by both the GPU and the CPU
    Managed = 1,

    // stored in system memory
    // can be accessed only by the CPU
    SystemMem = 2,

    // stored in
    Scratch = 3,

    ForceDword = 0x7fffffff,

    InvalidMax = 0xffffffff,
}

#[repr(u32)]
#[derive(Default, Debug, Copy, Clone, PartialEq, Eq)]
#[binrw]
#[br(repr = u32)]
#[bw(repr = u32)]
pub enum D3DRenderStateType {
    ZEnable = 7,
    FillMode = 8,
    ShadeMode = 9,
    LinePattern = 10,
    ZWriteEnable = 14,
    AlphaTestEnable = 15,
    LastPixel = 16,
    SrcBlend = 19,
    DestBlend = 20,
    CullMode = 22,
    ZFunc = 23,
    AlphaRef = 24,
    AlphaFunc = 25,
    DitherEnable = 26,
    AlphaBlendEnable = 27,
    FogEnable = 28,
    SpecularEnable = 29,
    ZVisible = 30,
    FogColor = 34,
    FogTableMode = 35,
    FogStart = 36,
    FogEnd = 37,
    FogDensity = 38,
    EdgeAntialias = 40,
    ZBias = 47,
    RangeFogEnable = 48,
    StencilEnable = 52,
    StencilFail = 53,
    StencilZFail = 54,
    StencilPass = 55,
    StencilFunc = 56,
    StencilRef = 57,
    StencilMask = 58,
    StencilWriteMask = 59,
    TextureFactor = 60,
    Wrap0 = 128,
    Wrap1 = 129,
    Wrap2 = 130,
    Wrap3 = 131,
    Wrap4 = 132,
    Wrap5 = 133,
    Wrap6 = 134,
    Wrap7 = 135,
    Clipping = 136,
    Lighting = 137,
    Ambient = 139,
    FogVertexMode = 140,
    ColorVertex = 141,
    LocalViewer = 142,
    NormalizeNormals = 143,
    DiffuseMaterialSource = 145,
    SpecularMaterialSource = 146,
    AmbientMaterialSource = 147,
    EmissiveMaterialSource = 148,
    VertexBlend = 151,
    ClipPlaneEnable = 152,
    SoftwareVertexProcessing = 153,
    PointSize = 154,
    PointSizeMin = 155,
    PointSpriteEnable = 156,
    PointScaleEnable = 157,
    PointScaleA = 158,
    PointScaleB = 159,
    PointScaleC = 160,
    MultisampleAntialias = 161,
    MultisampleMask = 162,
    PatchEdgeStyle = 163,
    PatchSegments = 164,
    DebugMonitorToken = 165,
    PointSizeMax = 166,
    IndexedVertexBlendEnable = 167,
    ColorWriteEnable = 168,
    TweenFactor = 170,
    BlendOp = 171,
    PositionOrder = 172,
    NormalOrder = 173,

    ForceDword = 0x7fffffff,
    #[default]
    InvalidIndex = 0xffffffff,
}

#[derive(Debug, Clone)]
#[repr(u32)]
#[binrw]
#[br(repr = u32)]
#[bw(repr = u32)]
pub enum D3DCmpFunc {
    Never = 1,
    Less = 2,
    Equal = 3,
    LessEqual = 4,
    Greater = 5,
    NotEqual = 6,
    GreaterEqual = 7,
    Always = 8,
    ForceDword = 0x7fffffff,
}

#[repr(u32)]
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
#[binrw]
#[br(repr = u32)]
#[bw(repr = u32)]
pub enum D3DBlend {
    Zero = 1,
    One = 2,
    SrcColor = 3,
    InvSrcColor = 4,
    SrcAlpha = 5,
    InvSrcAlpha = 6,
    DestAlpha = 7,
    InvDestAlpha = 8,
    DestColor = 9,
    InvDestColor = 10,
    SrcAlphaSat = 11,
    BothSrcAlpha = 12,
    BothInvSrcAlpha = 13,
    ForceDword = 0x7fffffff,
}

#[repr(u32)]
#[derive(Default, Debug, Copy, Clone, PartialEq, Eq)]
#[binrw]
#[br(repr = u32)]
#[bw(repr = u32)]
pub enum D3DPrimitiveType {
    PointList = 1,
    LineList = 2,
    LineStrip = 3,
    TriangleList = 4,
    TriangleStrip = 5,
    TriangleFan = 6,

    #[default]
    ForceDword = 0x7fffffff,

    InvalidMax = 0xffffffff,
}

/**
 * typedef struct _D3DVERTEXELEMENT9 {
    WORD Stream;
    WORD Offset;
    BYTE Type;
    BYTE Method;
    BYTE Usage;
    BYTE UsageIndex;
} D3DVERTEXELEMENT9;

 */

#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[binrw]
pub struct D3DVertexElement9 {
    pub stream: u16,
    pub offset: u16,

    pub _type: u8,
    pub method: u8,
    pub usage: u8,
    pub usage_index: u8,
}
