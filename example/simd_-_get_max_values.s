# simd - get max values
#  
# ----------------------------------------------------------------------------------------
    .intel_syntax noprefix

    .global _start

		.data
data1:
    .float 0.1, 0.2, 0.3, 0.4
data2:
    .float 0.4, 0.3, 0.2, 0.1

    .text
_start:
 
    movdqu  xmm1, data1  # load xmm1
    movdqu  xmm2, data2  # load xmm2
    movups  xmm0, xmm1   # xmm0 is both input and output in cmpltps
    cmpltps xmm0, xmm2   # xmm0 becomes the mask (xmm0[i]=-1 if xmm0[i] < xmm2[i], 0 otherwise)
    blendvps xmm1,xmm2   # xmm1 is the max(xmm1, xmm2) (xmm1[i]=xmm2[i] if xmm0[i]=-1)

