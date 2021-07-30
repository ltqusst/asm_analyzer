# ----------------------------------------------------------------------------------------
# Writes "Hello, World" to the console using only system calls. Runs on 64-bit Linux only.
# To assemble and run:
#
#     gcc -c hello.s && ld hello.o && ./a.out
#
# or
# 
#     gcc -no-pie -nostdlib hello.s && ./a.out
#
# what PIE means? 
#    https://stackoverflow.com/questions/52126328/cant-call-c-standard-library-function-on-64-bit-linux-from-assembly-yasm-code/52131094#52131094
#
# ----------------------------------------------------------------------------------------

        .intel_syntax noprefix

        .global _start

        .text
_start:
        # write(1, message, 13)
        
        movdqu  xmm1, data1
        movdqu  xmm2, data2
        movups  xmm0, xmm1
        cmpltps xmm0, xmm2
        blendvps xmm1,xmm2   # xmm0 is the mask

        mov     rax, 2                # system call 1 is write
        mov     rdi, 2                # file handle 1 is stdout
        cmp     rax, rdi
        je      _next
        mov     rsi,message          # address of string to output
_next:
        mov     rdx, 13               # number of bytes

        # exit(0)
        mov     rax, 60               # system call 60 is exit
        xor     rdi, rdi              # we want return code 0
        syscall                         # invoke operating system to exit

        .data
data1:
        .float 0.1, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3, 0.4
data2:
        .float 0.4, 0.3, 0.2, 0.1
message:
        .ascii  "Helloworld!\n"
