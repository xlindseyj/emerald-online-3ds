#include <3ds.h>
#include <string.h>

#define CURRENT_KTHREAD  0xFFFF9000
#define CURRENT_KPROCESS 0xFFFF9004

unsigned int __ctr_svchax = 0;

typedef u32 (*backdoor_fn)(u32 arg0, u32 arg1);

__attribute__((naked))
static u32 svc_7b(backdoor_fn entry_fn, ...)
{
   __asm__ volatile(
      "push {r0, r1, r2} \n\t"
      "mov r3, sp \n\t"
      "add r0, pc, #12 \n\t"
      "svc 0x7B \n\t"
      "add sp, sp, #8 \n\t"
      "ldr r0, [sp], #4 \n\t"
      "bx lr \n\t"
      "cpsid aif \n\t"
      "ldr r2, [r3], #4 \n\t"
      "ldmfd r3!, {r0, r1} \n\t"
      "push {r3, lr} \n\t"
      "blx r2 \n\t"
      "pop {r3, lr} \n\t"
      "str r0, [r3, #-4]! \n\t"
      "bx lr \n\t");
   return 0;
}

static void k_enable_all_svcs(u32 isNew3DS)
{
   u32 *thread_acl  = *(*(u32 ***)CURRENT_KTHREAD + 0x22) - 0x6;
   u32 *process_acl = *(u32 **)CURRENT_KPROCESS + (isNew3DS ? 0x24 : 0x22);
   memset(thread_acl, 0xFF, 0x10);
   memset(process_acl, 0xFF, 0x10);
}

Result svchax_init(bool patch_srv)
{
   (void)patch_srv;
   s64 version = 0;
   bool isNew3DS = false;

   if (R_FAILED(svcGetSystemInfo(&version, 0x10000, 0)) ||
       GET_VERSION_MAJOR((u32)version) < 8)
      return -1;

   if (R_FAILED(APT_CheckNew3DS(&isNew3DS)))
      return -2;

   svc_7b((backdoor_fn)k_enable_all_svcs, isNew3DS);
   __ctr_svchax = 1;
   return 0;
}
