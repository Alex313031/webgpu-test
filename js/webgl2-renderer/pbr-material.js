// Copyright 2020 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { ShaderProgram } from '../webgl-renderer/shader-program.js';

export const ATTRIB_MAP = {
  POSITION: 1,
  NORMAL: 2,
  TANGENT: 3,
  TEXCOORD_0: 4,
  COLOR_0: 5,
};

export const SAMPLER_MAP = {
  baseColorTexture: 0,
  normalTexture: 1,
  metallicRoughnessTexture: 2,
  emissiveTexture: 3,
  occlusionTexture: 4
};

export const UNIFORM_BLOCKS = {
  FrameUniforms: 0,
  MaterialUniforms: 1
}

const PBR_VERTEX_SOURCE = `
layout(location = ${ATTRIB_MAP.POSITION}) in vec3 POSITION;
layout(location = ${ATTRIB_MAP.NORMAL}) in vec3 NORMAL;
layout(location = ${ATTRIB_MAP.TEXCOORD_0}) in vec2 TEXCOORD_0;

layout(std140) uniform FrameUniforms
{
  mat4 projectionMatrix;
  mat4 viewMatrix;
  vec3 cameraPosition;
  vec3 lightDirection;
  vec3 lightColor;
};

uniform mat4 modelMatrix;

out vec3 vLight; // Vector from vertex to light.
out vec3 vLightColor; // Light color.
out vec3 vView; // Vector from vertex to camera.
out vec2 vTex;

#ifdef USE_NORMAL_MAP
layout(location = ${ATTRIB_MAP.TANGENT}) in vec4 TANGENT;
out mat3 vTBN;
#else
out vec3 vNorm;
#endif

#ifdef USE_VERTEX_COLOR
layout(location = ${ATTRIB_MAP.COLOR_0}) in vec4 COLOR_0;
out vec4 vCol;
#endif

void main() {
  vec3 n = normalize(vec3(modelMatrix * vec4(NORMAL, 0.0)));
#ifdef USE_NORMAL_MAP
  vec3 t = normalize(vec3(modelMatrix * vec4(TANGENT.xyz, 0.0)));
  vec3 b = cross(n, t) * TANGENT.w;
  vTBN = mat3(t, b, n);
#else
  vNorm = n;
#endif

#ifdef USE_VERTEX_COLOR
  vCol = COLOR_0;
#endif

  vTex = TEXCOORD_0;
  vec4 mPos = modelMatrix * vec4(POSITION, 1.0);
  vLight = -lightDirection;
  vLightColor = lightColor;
  vView = cameraPosition - mPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * mPos;
}`;

// These equations are borrowed with love from this docs from Epic because I
// just don't have anything novel to bring to the PBR scene.
// http://blog.selfshadow.com/publications/s2013-shading-course/karis/s2013_pbs_epic_notes_v2.pdf
const EPIC_PBR_FUNCTIONS = `
vec3 lambertDiffuse(vec3 cDiff) {
  return cDiff / M_PI;
}

float specD(float a, float nDotH) {
  float aSqr = a * a;
  float f = ((nDotH * nDotH) * (aSqr - 1.0) + 1.0);
  return aSqr / (M_PI * f * f);
}

float specG(float roughness, float nDotL, float nDotV) {
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float gl = nDotL / (nDotL * (1.0 - k) + k);
  float gv = nDotV / (nDotV * (1.0 - k) + k);
  return gl * gv;
}

vec3 specF(float vDotH, vec3 F0) {
  float exponent = (-5.55473 * vDotH - 6.98316) * vDotH;
  float base = 2.0;
  return F0 + (1.0 - F0) * pow(base, exponent);
}`;

const PBR_FRAGMENT_SOURCE = `
precision highp float;

layout(std140) uniform MaterialUniforms {
  vec4 baseColorFactor;
  vec2 metallicRoughnessFactor;
  vec3 emissiveFactor;
  float occlusionStrength;
};

#define M_PI 3.14159265

out vec4 outputColor;

#ifdef USE_BASE_COLOR_MAP
uniform sampler2D baseColorTexture;
#endif

in vec3 vLight;
in vec3 vLightColor;
in vec3 vView;
in vec2 vTex;

#ifdef USE_VERTEX_COLOR
in vec4 vCol;
#endif

#ifdef USE_NORMAL_MAP
uniform sampler2D normalTexture;
in mat3 vTBN;
#else
in vec3 vNorm;
#endif

#ifdef USE_METAL_ROUGH_MAP
uniform sampler2D metallicRoughnessTexture;
#endif

#ifdef USE_OCCLUSION
uniform sampler2D occlusionTexture;
#endif

#ifdef USE_EMISSIVE_TEXTURE
uniform sampler2D emissiveTexture;
#endif

const vec3 dielectricSpec = vec3(0.04);
const vec3 black = vec3(0.0);

${EPIC_PBR_FUNCTIONS}

void main() {
#ifdef USE_BASE_COLOR_MAP
  vec4 baseColor = texture(baseColorTexture, vTex) * baseColorFactor;
#else
  vec4 baseColor = baseColorFactor;
#endif

#ifdef USE_VERTEX_COLOR
  baseColor *= vCol;
#endif

#ifdef USE_NORMAL_MAP
  vec3 n = texture(normalTexture, vTex).rgb;
  n = normalize(vTBN * (2.0 * n - 1.0));
#else
  vec3 n = normalize(vNorm);
#endif

#ifdef FULLY_ROUGH
  float metallic = 0.0;
#else
  float metallic = metallicRoughnessFactor.x;
#endif

  float roughness = metallicRoughnessFactor.y;

#ifdef USE_METAL_ROUGH_MAP
  vec4 metallicRoughness = texture(metallicRoughnessTexture, vTex);
  metallic *= metallicRoughness.b;
  roughness *= metallicRoughness.g;
#endif

  vec3 l = normalize(vLight);
  vec3 v = normalize(vView);
  vec3 h = normalize(l+v);

  float nDotL = clamp(dot(n, l), 0.001, 1.0);
  float nDotV = abs(dot(n, v)) + 0.001;
  float nDotH = max(dot(n, h), 0.0);
  float vDotH = max(dot(v, h), 0.0);

  // From GLTF Spec
  vec3 cDiff = mix(baseColor.rgb * (1.0 - dielectricSpec.r), black, metallic); // Diffuse color
  vec3 F0 = mix(dielectricSpec, baseColor.rgb, metallic); // Specular color
  float a = roughness * roughness;

#ifdef FULLY_ROUGH
  vec3 specular = F0 * 0.45;
#else
  vec3 F = specF(vDotH, F0);
  float D = specD(a, nDotH);
  float G = specG(roughness, nDotL, nDotV);
  vec3 specular = (D * F * G) / (4.0 * nDotL * nDotV);
#endif
  float halfLambert = dot(n, l) * 0.5 + 0.5;
  halfLambert *= halfLambert;

  vec3 color = (halfLambert * vLightColor * lambertDiffuse(cDiff)) + specular;

#ifdef USE_OCCLUSION
  float occlusion = texture(occlusionTexture, vTex).r;
  color = mix(color, color * occlusion, occlusionStrength);
#endif

  vec3 emissive = emissiveFactor;
#ifdef USE_EMISSIVE_TEXTURE
  emissive *= texture(emissiveTexture, vTex).rgb;
#endif
  color += emissive;

  // gamma correction
  color = pow(color, vec3(1.0/2.2));

  outputColor = vec4(color, baseColor.a);
}`;

export class PBRShaderProgram extends ShaderProgram {
  constructor(gl, defines) {
    super(gl, {
      vertexSource: PBR_VERTEX_SOURCE,
      fragmentSource: PBR_FRAGMENT_SOURCE,
      defines,
      version: '300 es'
    });

    this.opaqueMaterials = new Map(); // Material -> Primitives
    this.blendedMaterials = new Map(); // Material -> Primitives
  }

  static getProgramDefines(primitive) {
    const attributes = primitive.enabledAttributes;
    const material = primitive.material;
    const programDefines = {};

    if (attributes.has('COLOR_0')) {
      programDefines['USE_VERTEX_COLOR'] = 1;
    }

    if (attributes.has('TEXCOORD_0')) {
      if (material.baseColorTexture) {
        programDefines['USE_BASE_COLOR_MAP'] = 1;
      }

      if (material.normalTexture && (attributes.has('TANGENT'))) {
        programDefines['USE_NORMAL_MAP'] = 1;
      }

      if (material.metallicRoughnessTexture) {
        programDefines['USE_METAL_ROUGH_MAP'] = 1;
      }

      if (material.occlusionTexture) {
        programDefines['USE_OCCLUSION'] = 1;
      }

      if (material.emissiveTexture) {
        programDefines['USE_EMISSIVE_TEXTURE'] = 1;
      }
    }

    if ((!material.metallicRoughnessTexture ||
         !(attributes.has('TEXCOORD_0'))) &&
         material.metallicRoughnessFactor[1] == 1.0) {
      programDefines['FULLY_ROUGH'] = 1;
    }

    return programDefines;
  }
}
