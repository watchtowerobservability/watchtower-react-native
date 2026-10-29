#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WatchtowerRN, NSObject)
RCT_EXTERN_METHOD(start:(NSDictionary *)options)
RCT_EXTERN_METHOD(record:(NSString *)json)
RCT_EXTERN_METHOD(flush)
@end
