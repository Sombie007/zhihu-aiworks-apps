/* ============================================================================
   程序员避坑指南 · 内容数据
   只放数据，不放逻辑。浏览器：window.APP_DATA；Node：require('./data.js')
   代码示例里以“关键”开头的注释，界面上会把那一行标出来。
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.APP_DATA = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {
    meta: {
      appId: 'coder-pitfalls',
      name: '程序员避坑指南',
      version: '2.0.0',
      updatedAt: '2026-11-28',
      makerUrl: 'https://www.zhihu.com/people/xdong-she',
      readDelayMs: 5000,
      pageSize: 60,
      languages: {
        java: 'Java',
        js: 'JavaScript',
        sql: 'SQL',
        shell: 'Shell',
        yaml: 'YAML',
        properties: 'Properties',
        conf: '配置文件',
        text: '文本'
      }
    },

    categories: [
      { id: 'java', label: 'Java 基础', short: 'Java',
        desc: '集合、字符串、异常、对象拷贝、Stream 和线程池，都是每天要写的代码。' },
      { id: 'spring', label: 'Spring 生态', short: 'Spring',
        desc: '依赖注入、事务、自动配置、事件和服务间调用，Spring 生态里最容易踩的坑。' },
      { id: 'redis', label: 'Redis', short: 'Redis',
        desc: '缓存失效、双写一致性、持久化、分布式锁、大 key 和淘汰策略。' },
      { id: 'mysql', label: 'MySQL', short: 'MySQL',
        desc: '索引、事务与隔离级别、分页、MVCC，以及大表上的结构变更。' },
      { id: 'ai', label: 'AI 与编程', short: 'AI',
        desc: 'AI 生成的代码怎么验收、什么场景适合 vibe coding、调用成本怎么控制。' },
      { id: 'engineering', label: '工程实践', short: '工程',
        desc: '幂等、定时任务、批量处理、回滚、配置、编码、时区、日志和测试。' },
      { id: 'career', label: '职场成长', short: '职场',
        desc: '求职面试、技术选型、注释与数据结构、工作流，以及学习和调试的方法。' }
    ],

    entries: [
      /* ---------------- Java 基础 ---------------- */
      {
        id: 'java-null-for-gc',
        title: '用赋值 null 帮助垃圾回收',
        category: 'java',
        difficulty: '入门',
        tags: ['JVM', '内存', '垃圾回收'],
        scenario: '大对象用完之后内存迟迟不释放，尤其是缓存、静态集合这类长生命周期的对象里，还挂着一批很大的对象。',
        symptom: '内存占用居高不下，垃圾回收之后老年代也没降多少，Dump 出来是一批早已用不上的大对象。',
        cause: '垃圾回收只看对象是否可达。只要长生命周期的对象还引用着它，哪怕业务上早就不用了，它也算可达，回收不掉。',
        fix: [
          '把大对象的引用从长生命周期对象里及时移除，必要时显式赋值为 null。',
          '局部变量不用刻意置 null，方法结束出栈之后自然不可达，到处补 null 只是噪音。',
          '真正该做的是缩小对象的存活范围，而不是在代码里到处补 null。'
        ],
        example: {
          lang: 'java',
          bad: `public class TaskContext {
    private static TaskContext current;   // 静态字段，生命周期和类一样长
    private byte[] payload;               // 处理完之后没人清，一直可达

    void run(byte[] payload) {
        this.payload = payload;
        process(payload);
        current = this;                   // 关键：几十 MB 的 payload 被静态引用牵着，回收不掉
    }
}`,
          good: `void run(byte[] payload) {
    this.payload = payload;
    try {
        process(payload);
    } finally {
        this.payload = null;              // 关键：用完立刻断开引用，大对象才能提前被回收
    }
    current = this;
}`
        },
        principle: '回收的前提是不可达：缩短对象的存活范围，比到处补 null 有用。',
        related: ['java-hashmap-concurrent', 'java-shallow-copy', 'eng-load-all-data']
      },
      {
        id: 'java-overload-vs-override',
        title: '混淆重载与重写',
        category: 'java',
        difficulty: '入门',
        tags: ['面向对象', '基础', '面试'],
        scenario: '面试被问到二者的区别；或者代码里方法名相同、行为却和预期不一样，需要判断到底走的是哪个方法。',
        symptom: '以为会按运行时的实际类型调用，结果调用到的是另一个重载；或者以为重写了父类方法，其实只是多写了一个重载。',
        cause: '重载是方法名相同、参数不同，由编译期根据参数的静态类型决定；重写是子类重新实现父类的同名同参方法，由运行期按对象的实际类型决定。两者的判定时机根本不同。',
        fix: [
          '记住口诀：重载看参数，重写看继承。',
          '重载不能只靠返回值区分，调用方不看返回值。',
          '想重写就保证方法名和参数都一致，并加上 @Override 让编译器替你确认。'
        ],
        example: {
          lang: 'java',
          bad: `class Base {
    void send(String msg) { System.out.println("base: " + msg); }
}

class Sub extends Base {
    // 关键：参数写成了 Object，本意是重写，实际只是重载，父类方法原样保留
    void send(Object msg) { System.out.println("sub: " + msg); }
}
// new Sub().send("hi") 调用的是 Base.send(String)，不是你以为的那个`,
          good: `class Base {
    void send(String msg) { System.out.println("base: " + msg); }
}

class Sub extends Base {
    @Override                            // 关键：同名同参才是重写，写错了 @Override 会直接编译报错
    void send(String msg) { System.out.println("sub: " + msg); }
}
// new Sub().send("hi") 调用的是 Sub.send(String)`
        },
        principle: '重载看参数，编译期定；重写看继承，运行期定。',
        related: ['java-boxed-equals', 'java-interface-vs-abstract']
      },
      {
        id: 'java-hashmap-concurrent',
        title: '在并发场景使用 HashMap',
        category: 'java',
        difficulty: '进阶',
        tags: ['集合', '并发', '面试'],
        scenario: '多个线程读写同一个 Map，比如把它当成全局缓存或计数器；或者面试被问到 HashMap 在 JDK 7 和 JDK 8 的区别。',
        symptom: '数据莫名丢失，CPU 飙高甚至卡在扩容上；单测跑不出来，一到并发就出问题。',
        cause: 'HashMap 不是线程安全的。JDK 7 用头插法，并发扩容时链表可能被反转成环；JDK 8 改成了尾插法并引入红黑树，但依然没有任何同步措施。',
        fix: [
          '并发读写一律用 ConcurrentHashMap，不要指望 HashMap。',
          '讲清 JDK 8 的三处变化：链表长度 ≥ 8 且数组长度 ≥ 64 时转红黑树；插入从头插改为尾插；扩容后元素位置要么不变、要么翻倍。',
          '面试追问“为什么位置要么不变、要么翻倍”，答的是用 hash 与旧容量做按位与来判断。'
        ],
        example: {
          lang: 'java',
          bad: `private static final Map<String, Integer> COUNTER = new HashMap<>();

public void record(String user) {
    Integer old = COUNTER.get(user);       // 多个线程同时读写，没有任何同步
    COUNTER.put(user, old == null ? 1 : old + 1);   // 关键：读和写分成两步，并发时更新会丢失
}`,
          good: `private static final Map<String, Integer> COUNTER = new ConcurrentHashMap<>();

public void record(String user) {
    // 关键：用原子方法做“读改写”，既线程安全，又不用自己加锁
    COUNTER.merge(user, 1, Integer::sum);
}`
        },
        principle: 'HashMap 只适合单线程，并发场景换 ConcurrentHashMap。',
        related: ['java-executors-thread-pool', 'career-ds-in-practice']
      },
      {
        id: 'java-string-concat-loop',
        title: '循环里用 String 拼接字符串',
        category: 'java',
        difficulty: '入门',
        tags: ['字符串', '性能', '基础'],
        scenario: '在循环里拼日志、拼 SQL、拼报文，次数一多就是成千上万次拼接。',
        symptom: '一次拼接看不出问题，循环上万次之后 CPU 和内存都被临时对象吃掉，垃圾回收明显变频繁。',
        cause: 'String 是不可变的，每次拼接都会新建对象；循环里的拼接等于拿着越来越长的内容反复复制。',
        fix: [
          '循环里的拼接用 StringBuilder，单线程下足够快。',
          'StringBuffer 是线程安全的，但拼接场景很少有共享竞争，基本用不上。',
          '不在循环里的单次拼接用加号即可，编译器会自动优化。'
        ],
        example: {
          lang: 'java',
          bad: `String buildReport(List<String> lines) {
    String result = "";
    for (String line : lines) {
        result += line + "\\n";           // 关键：每次循环都新建 String，前面的内容被反复复制
    }
    return result;
}`,
          good: `String buildReport(List<String> lines) {
    StringBuilder sb = new StringBuilder(lines.size() * 32);
    for (String line : lines) {
        sb.append(line).append('\\n');    // 关键：始终在同一个 StringBuilder 上追加
    }
    return sb.toString();
}`
        },
        principle: '循环外随便拼，循环里必须用 StringBuilder。',
        related: ['java-null-for-gc', 'eng-load-all-data']
      },
      {
        id: 'java-boxed-equals',
        title: '用 == 比较包装类型',
        category: 'java',
        difficulty: '入门',
        tags: ['基础', 'Integer', '面试'],
        scenario: '比较 Integer、Long 这类包装类型，或者判断对象字段是否相等时顺手写了 ==。',
        symptom: '测试数据很小的时候全部通过，数值一超过 127 结果就变成 false，问题只在特定数据上出现。',
        cause: '== 比较的是两个引用是否指向同一个对象。Integer 缓存了 -128 到 127 的对象，这个区间内自动装箱拿到的是同一个对象，超出区间就是另外新建的对象。',
        fix: [
          '包装类型比较一律用 equals，这条写进团队规范。',
          '基本类型用 == 比值；对象用 equals 比内容，自定义类记得重写 equals。',
          '让新人知道 127 这条线是缓存造成的假象，不是比较规则变了。'
        ],
        example: {
          lang: 'java',
          bad: `Integer a = 127, b = 127;
System.out.println(a == b);              // true：来自缓存里的同一个对象，容易让人误以为没问题

Integer c = 128, d = 128;
System.out.println(c == d);              // 关键：超出了缓存区间，是两个不同的对象，结果是 false`,
          good: `Integer a = 127, b = 127;
Integer c = 128, d = 128;

System.out.println(a.equals(b));         // true
System.out.println(c.equals(d));         // 关键：比较内容用 equals，结果不依赖缓存区间`
        },
        principle: '包装类型比较永远用 equals。',
        related: ['java-overload-vs-override', 'mysql-index-invalid']
      },
      {
        id: 'java-interface-vs-abstract',
        title: '接口与抽象类选错',
        category: 'java',
        difficulty: '进阶',
        tags: ['面向对象', '设计', '基础'],
        scenario: '设计一组有公共流程的类，要决定公共代码放接口、放抽象类，还是各写一份。',
        symptom: '每个实现类都复制一遍同样的流程代码；或者为了复用几个方法，硬把不相关的类塞进同一条继承链。',
        cause: '接口回答的是“能做什么”，是能力契约，一个类可以实现多个；抽象类回答的是“是什么”，用来做模板复用，可以共享状态和实现，但只能继承一个。',
        fix: [
          '先用接口定义契约，再把公共流程和共享状态下沉到抽象类。',
          '“支付能力”这类能力用接口声明，“订单服务的公共流程”这类模板用抽象类承载。'
        ],
        example: {
          lang: 'java',
          bad: `abstract class PayService {                 // 为了复用 log()，让不相干的服务也来继承
    abstract void pay(Order order);
    void log(Order order) { System.out.println(order); }
}

class RefundService extends PayService {    // 关键：退款不是一种支付，只是为了 log() 才继承
    void pay(Order order) { /* 退款逻辑被硬塞进了 pay 方法 */ }
}`,
          good: `interface Payable {                         // 能力：能做什么
    void pay(Order order);
}

abstract class AbstractOrderService implements Payable {   // 模板：是什么，以及公共流程
    // 关键：公共实现和共享状态放在抽象类里，契约留在接口上
    void log(Order order) { System.out.println(order); }
}`
        },
        principle: '先接口定义契约，公共代码下沉抽象类。',
        related: ['java-overload-vs-override', 'career-approval-flow']
      },
      {
        id: 'java-swallow-exception',
        title: '在 catch 里吞掉异常',
        category: 'java',
        difficulty: '入门',
        tags: ['异常', '健壮性', '日志'],
        scenario: '写 try-catch 时不知道该怎么处理，顺手 catch 住什么都不做，或者为了“不让程序报错”把异常压下去。',
        symptom: '接口返回了一个看起来正常的结果，数据却是错的；翻日志什么都没有，排查只能靠猜。',
        cause: '异常被吞掉之后，调用方不知道出过错，现场信息也一起丢了；finally 里 return 还会把异常和前面的返回值一并覆盖掉。',
        fix: [
          '要么在 catch 里真正处理掉，要么带着上下文抛出去，不要两边都不做。',
          '日志里记录原始异常堆栈，不要只打一句错误信息。',
          '不要 catch Throwable 或 Exception 一刀切，只捕获自己能处理的异常。',
          'finally 里不要 return，否则会吞掉异常和返回值。'
        ],
        example: {
          lang: 'java',
          bad: `try {
    orderService.create(order);
} catch (Exception e) {
    return Result.ok();                   // 关键：异常被吞掉，调用方以为成功，日志里什么都没有
}`,
          good: `try {
    orderService.create(order);
} catch (Exception e) {
    // 关键：带上业务上下文和原始堆栈，出问题时能顺着查
    log.error("创建订单失败，orderNo={}", order.getOrderNo(), e);
    throw new OrderException("创建订单失败：" + order.getOrderNo(), e);   // 处理不了就带着原因抛出去
}`
        },
        principle: '异常要么处理，要么带着上下文抛出去，不要悄悄吞掉。',
        related: ['eng-request-trace', 'eng-happy-path-testing', 'java-executors-thread-pool']
      },
      {
        id: 'java-shallow-copy',
        title: '浅拷贝后直接改嵌套字段',
        category: 'java',
        difficulty: '进阶',
        tags: ['对象拷贝', '基础'],
        scenario: '从缓存或请求参数里拿到一个对象，复制一份之后直接改字段，再拿去保存或返回。',
        symptom: '只改了副本，原始数据（缓存里的、别人的那份）也跟着变了，排查时发现数据“莫名被改”。',
        cause: '浅拷贝只复制第一层引用，嵌套对象仍然是两边共享的同一个；深拷贝才会把所有层级都复制一份。',
        fix: [
          '拿到共享对象先判断是只读还是要修改：只读用浅拷贝就够，要改嵌套字段就深拷贝。',
          '深拷贝的实现方式：实现 Cloneable 逐层 clone、序列化再反序列化，或者用 MapStruct 这类工具。'
        ],
        example: {
          lang: 'java',
          bad: `Order draft = orderCache.get(orderNo);
Order copy = draft.toCopy();                 // 只复制了第一层，receiver 仍然是同一个对象
copy.getReceiver().setPhone(newPhone);       // 关键：改的是共享的嵌套对象，缓存里那份也被改了
orderMapper.update(copy);
// 之后别人从缓存里拿到的 draft，电话已经是新号码了`,
          good: `Order draft = orderCache.get(orderNo);
Order copy = draft.toCopy();

// 关键：嵌套对象也复制一份，才不会改到原件
copy.setReceiver(new Receiver(copy.getReceiver()));
copy.getReceiver().setPhone(newPhone);
orderMapper.update(copy);`
        },
        principle: '浅拷贝共享嵌套对象，要改就深拷贝。',
        related: ['java-null-for-gc', 'redis-cache-aside']
      },
      {
        id: 'java-stream-misuse',
        title: '误用 Stream 和 parallelStream',
        category: 'java',
        difficulty: '进阶',
        tags: ['Stream', 'JDK 8', '性能', '并发'],
        scenario: '看到 Stream 写法优雅，就把所有循环都改成 Stream；或者为了“提速”直接加 parallel()。',
        symptom: '数据量不大却没变快，甚至更慢；加了 parallel() 之后 IO 任务把公共线程池占满，其他用到 parallelStream 的任务一起变慢。',
        cause: 'Stream 的开销在小集合上抵不回收益；parallelStream 默认共用同一个 ForkJoinPool，IO 密集的任务会把它占满；在 Stream 里修改外部变量属于副作用，并行时更容易出错。',
        fix: [
          '小集合直接用普通 for 循环。',
          '大集合的“过滤 + 映射 + 归约”才是 Stream 的甜区。',
          'IO 密集的任务不要放在共享的 parallelStream 里跑。',
          '不要在 Stream 里修改外部变量，结果用 collect 收集。'
        ],
        example: {
          lang: 'java',
          bad: `List<String> result = new ArrayList<>();
ids.parallelStream().forEach(id -> {
    User user = userClient.getById(id);     // 远程调用跑在公共 ForkJoinPool 上，会拖垮其他并行任务
    if (user.isActive()) {
        result.add(user.getName());         // 关键：并行往 ArrayList 里写，是带副作用的操作，结果可能丢失
    }
});`,
          good: `List<String> result = ids.stream()              // 数据量不大时串行即可
        .map(userClient::getById)
        .filter(User::isActive)
        .map(User::getName)
        .collect(Collectors.toList());      // 关键：用 collect 收集结果，不去修改外部变量`
        },
        principle: 'Stream 适合大集合的聚合运算，不是万能加速器。',
        related: ['java-executors-thread-pool', 'eng-load-all-data', 'java-hashmap-concurrent']
      },
      {
        id: 'java-executors-thread-pool',
        title: '用 Executors 创建线程池',
        category: 'java',
        difficulty: '入门',
        tags: ['并发', '线程池', '规范'],
        scenario: '需要一个线程池时顺手写了 Executors.newFixedThreadPool 或 newCachedThreadPool。',
        symptom: '请求堆积之后内存溢出，或者线程数一路涨到把系统拖垮；问题在低流量时完全看不出来。',
        cause: 'FixedThreadPool 用的是无界队列，任务堆积只会占内存不会拒绝；CachedThreadPool 的线程数没有上限，来多少任务就开多少线程。',
        fix: [
          '用 new ThreadPoolExecutor 手动指定核心参数。',
          '队列用有界的，并设置拒绝策略。',
          '给线程起名字，出问题时看线程 Dump 能直接对上业务。'
        ],
        example: {
          lang: 'java',
          bad: `ExecutorService pool = Executors.newFixedThreadPool(8);
// 关键：它内部用的是无界队列，任务堆积时不会拒绝，只会一直占内存
// Executors.newCachedThreadPool() 则相反：线程数没有上限，流量一大就线程爆炸
pool.submit(() -> exportService.export(task));
pool.submit(() -> reportService.report(task));       // 什么任务都往里丢，出事了也分不清是谁`,
          good: `AtomicInteger seq = new AtomicInteger();
ThreadFactory named = r -> {
    Thread t = new Thread(r, "export-" + seq.incrementAndGet());   // 线程有名字，Dump 里一眼认得出
    return t;
};
ExecutorService pool = new ThreadPoolExecutor(
        4, 8, 60L, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(200),        // 关键：有界队列，满了才轮到拒绝策略
        named, new ThreadPoolExecutor.CallerRunsPolicy());`
        },
        principle: '线程池的参数要自己定，队列必须有界。',
        related: ['java-stream-misuse', 'spring-tx-too-long', 'eng-schedule-multi-instance']
      },
      /* ---------------- Spring 生态 ---------------- */
      {
        id: 'spring-new-dependencies',
        title: '在类里自己 new 依赖',
        category: 'spring',
        difficulty: '入门',
        tags: ['IOC', '依赖注入', '基础'],
        scenario: '写 Service 时直接 new 一个依赖对象，或者靠静态方法到处调用；换实现、写单测时才发现处处要改。',
        symptom: '换一个实现要动所有调用方；单元测试没法把依赖换成 Mock；对象的生命周期没人统一管。',
        cause: '自己 new 等于把“对象的装配权”留在每个类里，类和具体实现绑死。控制反转（IOC）是把这股权力交给容器：由容器创建对象、装配依赖、管理生命周期，代码只面向接口。',
        fix: [
          '依赖对象交给容器创建和装配，类里不自己 new。',
          '面向接口编程，换实现只改配置。',
          '说清控制反转的三点收益：松耦合（易替换）、可测试（Mock 注入）、集中管理（生命周期和切面）。'
        ],
        example: {
          lang: 'java',
          bad: `public class OrderService {
    // 关键：自己 new，类被绑死在具体实现和具体地址上，测试时也换不掉
    private final RiskClient riskClient = new RiskClientImpl("http://risk.internal");

    public boolean create(Order order) {
        return riskClient.check(order);
    }
}`,
          good: `public class OrderService {
    private final RiskClient riskClient;

    // 关键：依赖由容器注入，类只认接口，换实现只改配置
    public OrderService(RiskClient riskClient) {
        this.riskClient = riskClient;
    }
}`
        },
        principle: '控制反转是对象装配权的转移：类只认接口，装配交给容器。',
        related: ['spring-circular-dependency', 'spring-tx-self-invocation', 'eng-hardcoded-config']
      },
      {
        id: 'spring-circular-dependency',
        title: 'Bean 之间互相依赖',
        category: 'spring',
        difficulty: '进阶',
        tags: ['Bean', '依赖注入', '面试'],
        scenario: '两个 Bean 互相引用（A 注入 B，B 又注入 A），或者改成构造器注入之后启动直接失败；面试被问到三级缓存。',
        symptom: '字段注入的循环依赖平时能启动，一旦改成构造器注入就报错；Spring Boot 2.6 及以后默认直接拒绝启动。',
        cause: '三级缓存的办法是：Bean 实例化后先把早期引用放出去，属性注入时从缓存里拿，再完成初始化。构造器注入时 Bean 还没实例化，没有东西可以提前曝光，所以解不了；prototype 作用域的 Bean 每次都新建，也不走这套缓存。',
        fix: [
          '把循环依赖当成设计问题：Spring Boot 2.6 及以后默认禁止，这是好事，它逼你重新设计。',
          '把互相依赖的两部分拆开，抽出公共逻辑放到第三个 Bean 里，让依赖方向变成单向。'
        ],
        example: {
          lang: 'java',
          bad: `@Service
class OrderService {
    private final StockService stockService;
    OrderService(StockService stockService) { this.stockService = stockService; }
}

@Service
class StockService {
    private final OrderService orderService;
    // 关键：构造器互相引用，Bean 还没实例化就要对方的实例，启动直接报循环依赖
    StockService(OrderService orderService) { this.orderService = orderService; }
}`,
          good: `@Service
class OrderService {
    private final StockChecker checker;
    OrderService(StockChecker checker) { this.checker = checker; }
}

@Service
class StockChecker {                 // 关键：把互相调用的逻辑抽出来，依赖变成单向，环就解开了
    boolean enough(Order order) { return stockMapper.count(order.getSku()) >= order.getNum(); }
}`
        },
        principle: '循环依赖是设计问题，解环靠拆分，不靠开关。',
        related: ['spring-new-dependencies', 'spring-tx-self-invocation']
      },
      {
        id: 'spring-tx-self-invocation',
        title: '同类内部调用事务方法',
        category: 'spring',
        difficulty: '进阶',
        tags: ['事务', '@Transactional', 'AOP', '面试'],
        scenario: '在同一个类里，一个方法调用另一个带 @Transactional 的方法；或者事务方法里把异常 catch 掉了。',
        symptom: '明明加了 @Transactional，报错之后数据却没有回滚，而且只在特定的调用路径上出现。',
        cause: '@Transactional 靠代理对象生效。同类内部调用走的是 this，不经过代理，事务不会开启；异常被 catch 吞掉后容器不知道出了错；默认只回滚 RuntimeException，受检异常需要配 rollbackFor。',
        fix: [
          '事务方法不要在同类内部调用，拆到另一个 Bean 里，让它经过代理。',
          '事务方法保持 public。',
          '不要在事务方法里把异常吞掉，要回滚就让它抛出去。',
          '抛受检异常时配置 rollbackFor。',
          '确认表的引擎支持事务，MyISAM 不支持。'
        ],
        example: {
          lang: 'java',
          bad: `@Service
public class OrderService {
    public void place(Order order) {
        this.save(order);        // 关键：this 调用不经过代理，save 上的 @Transactional 不生效
    }

    @Transactional
    public void save(Order order) { orderMapper.insert(order); stockMapper.deduct(order); }
}`,
          good: `@Service
class OrderService {
    private final OrderWriter writer;
    OrderService(OrderWriter writer) { this.writer = writer; }
    public void place(Order order) {
        writer.save(order);      // 关键：跨 Bean 调用会经过代理，事务才生效
    }
}

@Service
class OrderWriter {
    @Transactional
    public void save(Order order) { orderMapper.insert(order); }
}`
        },
        principle: '@Transactional 只在经过代理的调用上生效。',
        related: ['spring-tx-too-long', 'spring-event-sync', 'mysql-isolation-level']
      },
      {
        id: 'spring-autoconfigure-blind',
        title: '引入依赖却不检查自动配置',
        category: 'spring',
        difficulty: '进阶',
        tags: ['Spring Boot', '自动配置', 'starter'],
        scenario: '加了一个 starter 之后，某个 Bean 莫名其妙就有了，或者自己写的 Bean 被覆盖、行为和预期不一样；需要自己写 starter。',
        symptom: '“为什么一引入依赖就自动生效了”“为什么我的 Bean 被覆盖了”，排查时找不到是谁把它装配进来的。',
        cause: '@EnableAutoConfiguration 会加载 META-INF/spring.factories（Spring Boot 2.7 及以后是 AutoConfiguration.imports）里的配置类，再由 @ConditionalOnClass、@ConditionalOnMissingBean 这类条件注解决定哪些配置生效。',
        fix: [
          '遇到“自动生效”的 Bean，先去查它的自动配置类和条件注解。',
          '想覆盖默认行为时，确认自己的 Bean 满足 @ConditionalOnMissingBean 的让位条件。',
          '自定义 starter 按同样的套路写：配置类、条件注解，再到注册文件里登记。'
        ],
        example: {
          lang: 'java',
          bad: `@Configuration
public class SmsAutoConfig {
    @Bean
    public SmsClient smsClient() {           // 关键：没加条件注解，只要依赖在 classpath 上就一定生效
        return new SmsClient(timeoutMs);
    }
}`,
          good: `@AutoConfiguration
public class SmsAutoConfig {
    @Bean
    @ConditionalOnMissingBean                // 关键：使用者自己定义了 SmsClient 时，这里自动让位
    public SmsClient smsClient() { return new SmsClient(timeoutMs); }
}
// 并在 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports 里登记这个类`
        },
        principle: '自动配置就是注册文件里的配置类加条件注解，行为不对先查这两样。',
        related: ['spring-slow-startup', 'spring-non-web-app', 'eng-hardcoded-config']
      },
      {
        id: 'spring-premature-microservices',
        title: '一上来就拆微服务',
        category: 'spring',
        difficulty: '资深',
        tags: ['微服务', '架构', '团队'],
        scenario: '新项目立项，或者老系统要重构，团队在纠结要不要上微服务、拆多细。',
        symptom: '团队只有几个人，却要维护几十个服务，联调、部署、排障的成本比业务本身还高。',
        cause: '把微服务当成了默认选项，没有先算分布式的复杂度：服务治理、网络调用、数据一致性。这些成本只有在业务边界清晰、独立部署确有收益时才划得来。',
        fix: [
          '先看团队规模（两个披萨原则），人手撑不起的服务数量不要拆。',
          '业务边界要清晰（领域驱动），不清晰就先在单体里把模块划好。',
          '独立部署的收益要大于分布式的复杂度成本，否则不拆。',
          '路径是“单体分模块，按需拆分”，不要为了微服务而微服务。'
        ],
        example: {
          lang: 'text',
          bad: `立项评审记录
背景：新项目立项，团队只有几个人
拆分方案：按“用户、订单、库存、支付、营销、消息、搜索、报表”拆出十几个服务
理由：规模大的公司都这么做，以后好扩展
结果：几个人维护几十个服务，联调一次要拉上所有人，排障要跨好几个服务`,
          good: `立项评审记录
第一步：先按领域划模块（用户、订单、库存……），但仍然是一个应用、一次部署
约束：每个模块的边界和接口写清楚，模块之间不允许跨模块直接读表
之后：哪个模块确实需要独立发布或独立扩容，再把哪个拆出去
结果：服务数量和团队规模相匹配，联调和排障都还在可控范围内`
        },
        principle: '单体分模块、按需拆分，比“为了微服务而微服务”健康得多。',
        related: ['spring-remote-call-timeout', 'eng-no-rollback-plan', 'career-architect-thinking']
      },
      {
        id: 'spring-non-web-app',
        title: '后台任务程序带着 Web 容器启动',
        category: 'spring',
        difficulty: '入门',
        tags: ['Spring Boot', '部署', '定时任务'],
        scenario: '写定时任务、消息消费者、批处理这类没有 HTTP 入口的后台程序，却直接用了 spring-boot-starter-web。',
        symptom: '每个实例都占着一个端口，端口冲突导致起不来；明明不对外服务，却多暴露了一个 HTTP 入口。',
        cause: '只要 classpath 里有 Web 依赖，Spring Boot 默认就会启动内嵌容器。后台程序并不需要它，白白多了端口占用、依赖面和攻击面。',
        fix: [
          '后台程序把 Web 依赖排除掉，或者设置 spring.main.web-application-type=none。',
          'Web 服务和后台 Worker 分开部署，各用各的启动方式，一套代码体系里这样做很常见。'
        ],
        example: {
          lang: 'yaml',
          bad: `spring:
  application:
    name: invoice-job
    # 依赖里有 spring-boot-starter-web：启动时会拉起内嵌容器
server:
  port: 8080                      # 关键：一个不对外服务的任务程序，白白占着端口、多了一个入口`,
          good: `spring:
  application:
    name: invoice-job
  main:
    # 关键：没有 HTTP 入口的后台程序，不启动 Web 容器
    web-application-type: none`
        },
        principle: '没有 HTTP 入口的程序，就不要带 Web 容器。',
        related: ['eng-schedule-multi-instance', 'spring-autoconfigure-blind']
      },
      {
        id: 'spring-slow-startup',
        title: '启动慢却不查 Bean 的加载范围',
        category: 'spring',
        difficulty: '进阶',
        tags: ['Spring Boot', '启动', '性能', 'Bean'],
        scenario: '应用启动越来越慢，本地调试和每次发布都被拖长；或者面试被问到“Spring 为什么启动时就实例化几乎所有 Bean”。',
        symptom: '启动时间随代码量一起涨，改一行配置也要等上半天。',
        cause: '单例 Bean 默认是饿汉加载：容器启动时就完成装配和依赖检查，把错误尽量在启动期暴露，而不是等到运行期（Fail Fast）。代价就是启动慢。',
        fix: [
          '用 @Lazy 把启动时用不到的 Bean 改成懒加载。',
          '用 @ConditionalOnXxx 条件装配，让不该加载的 Bean 根本不进容器。',
          '检查 @ComponentScan 的扫描范围，范围过大是启动慢的常见原因。'
        ],
        example: {
          lang: 'java',
          bad: `@SpringBootApplication
@ComponentScan("app")                // 关键：扫描范围盖住了所有公共模块，别人的 Bean 也被装进了容器
public class ReportApplication {
    public static void main(String[] args) { SpringApplication.run(ReportApplication.class, args); }
}`,
          good: `@SpringBootApplication
@ComponentScan("app.report")         // 关键：只扫自己的包，启动时只装配本应用需要的 Bean
public class ReportApplication {
    public static void main(String[] args) { SpringApplication.run(ReportApplication.class, args); }
}`
        },
        principle: '启动慢先查 Bean 的数量和扫描范围，饿汉加载是为 Fail Fast 付的成本。',
        related: ['spring-autoconfigure-blind', 'spring-circular-dependency', 'eng-no-rollback-plan']
      },
      {
        id: 'spring-mp-primary-key',
        title: '主键类型与 ID 策略不配套',
        category: 'spring',
        difficulty: '入门',
        tags: ['MyBatis-Plus', '主键', 'ID 生成'],
        scenario: '用 MyBatis-Plus 插入数据后要拿到自增主键；或者把主键策略换成雪花算法。',
        symptom: 'insert 之后实体里拿不到主键；或者换成 ASSIGN_ID 之后，雪花 ID 写不进表里，直接报溢出。',
        cause: '主键怎么生成由 @TableId 的 type 决定：数据库自增对应 IdType.AUTO，雪花算法对应 IdType.ASSIGN_ID。雪花 ID 是 64 位的长整数，表的列如果只是 int 就装不下。',
        fix: [
          '主键策略按来源选：数据库自增用 IdType.AUTO，分布式场景用 IdType.ASSIGN_ID。',
          '用 ASSIGN_ID 时，表的列和实体的字段都要用 64 位整型（bigint 和 Long）。',
          'insert 之后直接从实体上读主键，MyBatis-Plus 会自动回填。'
        ],
        example: {
          lang: 'java',
          bad: `@Data
public class OrderPO {
    @TableId(type = IdType.ASSIGN_ID)
    private Integer id;           // 关键：雪花 ID 是 64 位，字段却是 Integer，插入时直接溢出
    private String orderNo;
}`,
          good: `@Data
public class OrderPO {
    // 关键：主键策略和字段类型要配套，表的列也要是 bigint
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;
    private String orderNo;
}
// 数据库自增时改成 IdType.AUTO，列是 int 也可以；insert 之后直接从实体上读主键`
        },
        principle: 'ID 策略和主键类型要配套：雪花 ID 配 bigint。',
        related: ['eng-idempotency', 'mysql-index-btree']
      },
      {
        id: 'spring-remote-call-timeout',
        title: '服务间调用不设超时、重试与熔断',
        category: 'spring',
        difficulty: '资深',
        tags: ['微服务', '超时', '熔断', '稳定性'],
        scenario: '用 RestTemplate、Feign 或 RPC 调别的服务，上线前没有想过对方挂了会怎样。',
        symptom: '一个下游服务变慢，上游线程被占满，然后一层一层拖垮整条链路，也就是雪崩。',
        cause: '不设超时的调用会一直等下去，线程和连接被占着不还；没有熔断和降级，故障就顺着调用链往上蔓延。',
        fix: [
          '给每一次远程调用设置超时，不设超时的调用等于定时炸弹。',
          '配上重试和熔断（Resilience4j 或 Sentinel）防止雪崩，会重试的接口必须做成幂等的。',
          '准备降级兜底：返回缓存数据或默认值。',
          '调用链上任何服务要新增依赖之前，先评估它对整条链路的影响半径。'
        ],
        example: {
          lang: 'java',
          bad: `@Bean
public RestTemplate restTemplate() {
    // 关键：没有设置任何超时，下游一卡住，调用线程就一直被占着
    return new RestTemplate();
}`,
          good: `@Bean
public RestTemplate restTemplate() {
    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    // 关键：连接和读取都设上限，最多等这么久就把线程还回去
    factory.setConnectTimeout(2_000);
    factory.setReadTimeout(3_000);
    return new RestTemplate(factory);
}`
        },
        principle: '超时、重试加熔断、降级兜底，远程调用的三件套缺一不可。',
        related: ['eng-idempotency', 'spring-premature-microservices', 'redis-avalanche']
      },
      {
        id: 'spring-event-sync',
        title: 'Spring 事件监听器同步阻塞主流程',
        category: 'spring',
        difficulty: '进阶',
        tags: ['事件', '解耦', '异步'],
        scenario: '用 ApplicationEvent 把下单之后的积分、通知、风控拆开，各监听各的。',
        symptom: '主流程的耗时被某个监听器拖长；监听器一报错，主流程也跟着失败；调试时搞不清是谁在什么时候执行的。',
        cause: 'Spring 事件默认是同步执行的：publish 时就在当前线程里把所有监听器跑完，监听器慢，主流程就跟着慢。它解决的是同一进程里的解耦，不是异步，也跨不了服务。',
        fix: [
          '不需要即时结果的监听器加 @Async 并指定线程池，让它异步执行。',
          '跨服务的通知老老实实用 MQ，不要指望 Spring 事件。',
          '主流程依赖其结果的逻辑直接调用，不要藏进事件里，场景对了是解耦神器，场景错了是调试噩梦。'
        ],
        example: {
          lang: 'java',
          bad: `@Service
public class OrderService {
    @Autowired private ApplicationEventPublisher publisher;

    public void place(Order order) {
        orderMapper.insert(order);
        publisher.publishEvent(new OrderCreated(order));   // 关键：默认同步执行，通知、积分都跑完才返回
    }
}`,
          good: `@Component
public class PointsListener {
    // 关键：加上 @Async 和线程池，监听器不再阻塞主流程
    @Async("notifyExecutor")
    @EventListener
    public void onCreated(OrderCreated event) {
        pointsService.add(event.getOrder());
    }
}`
        },
        principle: 'Spring 事件是同进程解耦，不是异步，更不是 MQ。',
        related: ['spring-tx-self-invocation', 'eng-request-trace', 'java-executors-thread-pool']
      },
      {
        id: 'spring-tx-too-long',
        title: '事务范围过大',
        category: 'spring',
        difficulty: '进阶',
        tags: ['事务', '性能', '连接池', '远程调用'],
        scenario: '事务方法里除了写库，还调了远程接口、发了消息，或者做了一大段计算。',
        symptom: '并发一上来数据库连接就被占满，后面的请求排队等连接，接口的响应时间远超数据库操作本身需要的时间。',
        cause: '事务从开启到提交一直占着一个数据库连接。事务里的远程调用、发消息、耗时计算做得多慢，连接就被占多久；并发一高，连接池很快见底。',
        fix: [
          '缩小事务边界：事务方法里只保留必须一起成功或一起失败的数据库操作。',
          '远程调用、发消息、耗时计算挪到事务之外，纯查询也尽量放在事务之前。',
          '确实要“库里改完再发消息”的，用事务提交后的回调（如 @TransactionalEventListener），或者用本地消息表保证最终一致。'
        ],
        example: {
          lang: 'java',
          bad: `@Transactional
public void place(Order order) {
    orderMapper.insert(order);
    riskClient.check(order);           // 关键：远程调用裹在事务里，它有多慢，数据库连接就被占多久
    stockMapper.deduct(order.getSku(), order.getNum());
    mqProducer.send(new OrderCreated(order));
}`,
          good: `public void place(Order order) {
    riskClient.check(order);           // 关键：远程调用放在事务之外，不占着数据库连接干等
    orderWriter.save(order);           // 事务方法在 OrderWriter 上，里面只有数据库操作
    mqProducer.send(new OrderCreated(order));
}

@Service
class OrderWriter {
    @Transactional
    public void save(Order order) {    // 事务里只剩必须一起成功或一起失败的数据库操作
        orderMapper.insert(order);
        stockMapper.deduct(order.getSku(), order.getNum());
    }
}`
        },
        principle: '事务只包数据库操作，耗时的事情放到事务外面做。',
        related: ['spring-tx-self-invocation', 'spring-remote-call-timeout', 'eng-idempotency']
      },
      /* ---------------- Redis ---------------- */
      {
        id: 'redis-avalanche',
        title: '大量缓存 key 同时过期',
        category: 'redis',
        difficulty: '进阶',
        tags: ['缓存', '高可用', '雪崩'],
        scenario: '一批缓存用了相同的过期时间（比如批量预热的一批数据），或者 Redis 实例整体不可用。',
        symptom: '同一时刻缓存集体失效，请求全部落到数据库，数据库被压垮，整条链路跟着不可用。',
        cause: '雪崩的本质是缓存失效的时间过于集中：大量 key 同时过期，或者 Redis 本身宕机，数据库瞬间要承接全部流量。',
        fix: [
          '过期时间加随机值，比如基础时长再加 0 到 300 秒的随机偏移。',
          '热点数据不过期，靠异步更新。',
          'Redis 做高可用（哨兵或集群）。',
          '服务端加限流和降级兜底，数据库扛不住时先保护数据库。'
        ],
        example: {
          lang: 'shell',
          bad: `# 批量预热：所有 key 的过期时间一模一样，30 分钟后会同时失效
for id in $(cat hot-skus.txt); do
  ttl=1800
  redis-cli SET "sku:$id" "$(load_sku "$id")" EX "$ttl"     # 关键：失效时间扎堆，到点一起打到数据库
done`,
          good: `# 批量预热：把过期时间打散
for id in $(cat hot-skus.txt); do
  # 关键：基础时长之上加 0 到 300 秒的随机偏移，失效时间不再扎堆
  ttl=$((1800 + RANDOM % 300))
  redis-cli SET "sku:$id" "$(load_sku "$id")" EX "$ttl"
done`
        },
        principle: '雪崩的根子是失效时间扎堆，把它打散，再给数据库留兜底。',
        related: ['redis-penetration-breakdown', 'spring-remote-call-timeout', 'mysql-slow-query']
      },
      {
        id: 'redis-penetration-breakdown',
        title: '把缓存穿透和击穿混为一谈',
        category: 'redis',
        difficulty: '进阶',
        tags: ['缓存', '穿透', '击穿', '布隆过滤器'],
        scenario: '接口流量里混着大量不存在的 ID，或者某个热点 key 刚好在流量高峰时过期。',
        symptom: '缓存命中率骤降，数据库查询量猛增。一个是查的数据根本不存在，缓存永远不会有；另一个是一个热点 key 过期的瞬间，大量并发同时去查库。',
        cause: '穿透是“防没有”：查询的数据不存在，每次都穿过缓存打到数据库。击穿是“防过期”：某一个热点 key 过期的那一刻，并发请求同时回源。两者现象相似，对症的办法不同。',
        fix: [
          '穿透：缓存空值（设短过期）、上布隆过滤器、做参数校验。',
          '击穿：用互斥锁只让一个请求回源，热点 key 不过期或用逻辑过期。',
          '先分清是“数据没有”还是“key 过期”，再选对应的手段。'
        ],
        example: {
          lang: 'java',
          bad: `public Sku getSku(String id) {
    Sku sku = skuCache.get(id);
    if (sku == null) {
        sku = skuMapper.selectById(id);      // 关键：数据不存在时缓存永远不命中，每个请求都打到数据库
        if (sku != null) skuCache.put(id, sku);
    }
    return sku;
}`,
          good: `public Sku getSku(String id) {
    Sku sku = skuCache.get(id);
    if (sku != null) return sku.isEmpty() ? null : sku;      // 空值也缓存，读到空值直接返回
    sku = skuMapper.selectById(id);
    // 关键：查不到也缓存一个空对象并设短过期，后面同样的请求不会再打到数据库
    skuCache.put(id, sku == null ? Sku.EMPTY : sku, sku == null ? 60 : 3600);
    return sku;
}`
        },
        principle: '穿透防“没有”，击穿防“过期”，先分清再下药。',
        related: ['redis-avalanche', 'redis-cache-aside', 'redis-distributed-lock']
      },
      {
        id: 'redis-cache-aside',
        title: '缓存与数据库双写顺序随意',
        category: 'redis',
        difficulty: '资深',
        tags: ['缓存', '一致性', '双写'],
        scenario: '同一份数据既在数据库里又在缓存里，更新的时候要决定先改哪一个、缓存是更新还是删除。',
        symptom: '并发写的时候缓存里留下的是旧值，读到的数据和数据库对不上；删除失败时这种不一致会一直留到过期。',
        cause: '两个存储各自写入，没有原子性，中间还隔着网络，谁先谁后、谁快谁慢都可能。并发下“更新缓存”还会出现后发的旧值覆盖先发的新值。',
        fix: [
          '主流方案用 Cache Aside：先更新数据库，再删除缓存。',
          '删除而不是更新缓存，避免并发写互相覆盖。',
          '删除失败用重试队列，或者订阅 binlog（Canal）异步再删一次。',
          '接受短暂不一致，靠过期时间兜底；要强一致的数据就不要用缓存。'
        ],
        example: {
          lang: 'java',
          bad: `public void updatePrice(Sku sku) {
    skuCache.put(sku.getId(), sku);          // 先更新缓存、后更新数据库
    skuMapper.updateById(sku);               // 关键：并发写时旧值可能覆盖新值；这一步失败，缓存里已经是错的
}
// 之后读到的还是缓存里的旧值，和数据库对不上`,
          good: `public void updatePrice(Sku sku) {
    skuMapper.updateById(sku);               // 先更新数据库，以它为准
    skuCache.delete(sku.getId());            // 关键：删除而不是更新，下次读取时再从数据库加载
}
// 之后读不到缓存，再从数据库加载最新值并放回缓存`
        },
        principle: '先更新数据库，再删除缓存；强一致就别用缓存。',
        related: ['redis-penetration-breakdown', 'mysql-isolation-level', 'java-shallow-copy']
      },
      {
        id: 'redis-single-thread',
        title: '把 Redis 的瓶颈当成 CPU',
        category: 'redis',
        difficulty: '进阶',
        tags: ['原理', '性能', '面试'],
        scenario: 'Redis 响应变慢要定位原因，或者面试被问到“Redis 为什么快”“单线程为什么还这么快”。',
        symptom: '慢的时候去查 CPU，发现占用并不高；换更强的 CPU 也没有明显改善。',
        cause: 'Redis 快在四点：纯内存操作；命令由单线程执行，没有锁和上下文切换（Redis 6 起网络 IO 可以多线程）；IO 多路复用，单线程也能撑住上万连接；数据结构针对场景做过优化（SDS、跳表、ziplist 等）。它的瓶颈在内存和网络，不在 CPU。',
        fix: [
          '排查性能先看内存和网络：大 key、网络带宽、内存是否打满。',
          '避免会阻塞主线程的操作，比如对大 key 直接做 DEL。',
          '面试追问“单线程为什么快”，考的是你对瓶颈的理解：瓶颈是内存和网络，不是 CPU。'
        ],
        example: {
          lang: 'shell',
          bad: `# 响应变慢。因为“Redis 是单线程的”，所以认定是 CPU 不够用
top -o %CPU                             # 一看 CPU 占用并不高，却还是按 CPU 瓶颈去优化
# 关键：没有去看内存和网络，而真正的瓶颈根本不在 CPU
# 加实例、换更强的 CPU
# 结论：单线程就是不行，只能靠堆机器`,
          good: `# 关键：先看内存和网络，而不是 CPU
redis-cli INFO memory | grep used_memory_human          # 内存是否接近上限
redis-cli INFO stats | grep instantaneous_ops_per_sec   # 每秒处理的命令数
redis-cli --bigkeys                                    # 有没有大 key 挤占网络和主线程
redis-cli INFO clients | grep blocked_clients          # 有没有被慢命令阻塞的客户端`
        },
        principle: 'Redis 的瓶颈是内存和网络，不是 CPU。',
        related: ['redis-big-key', 'redis-eviction-policy', 'redis-persistence']
      },
      {
        id: 'redis-persistence',
        title: 'Redis 持久化配置不当',
        category: 'redis',
        difficulty: '进阶',
        tags: ['持久化', 'RDB', 'AOF', '运维'],
        scenario: 'Redis 里存的不只是可丢的缓存，还有会话、队列、计数这类丢了会出问题的数据，要决定开不开持久化、开哪一种。',
        symptom: '只开 RDB，宕机后丢掉最后一次快照之后的数据；只开 AOF，文件大、恢复慢；什么都不开，重启后数据全没了。',
        cause: 'RDB 是定时快照，文件小、恢复快，但两次快照之间的数据会丢；AOF 追加写命令日志，丢的数据少（appendfsync everysec 最多丢 1 秒），代价是文件大、恢复慢。两种各有取舍，单开一种都盖不全。',
        fix: [
          '生产环境两种都开：RDB 用于冷备和快速恢复，AOF 保证数据安全。',
          'AOF 的同步策略用 appendfsync everysec，在性能和数据安全之间折中。',
          '纯缓存场景可以都不开，重启之后回源重新加载即可。'
        ],
        example: {
          lang: 'conf',
          bad: `# 关键：只开了 RDB，两次快照之间写入的数据，宕机之后就没了
save 900 1
save 300 10
stop-writes-on-bgsave-error yes
appendonly no`,
          good: `save 900 1
save 300 10
appendonly yes                  # 关键：RDB 之外再开 AOF，宕机后最多只丢约 1 秒的数据
appendfsync everysec
# AOF 文件变大之后，用 BGREWRITEAOF 重写压缩`
        },
        principle: '生产环境 RDB 加 AOF 一起开，纯缓存可以都不开。',
        related: ['redis-eviction-policy', 'redis-single-thread', 'eng-no-rollback-plan']
      },
      {
        id: 'redis-distributed-lock',
        title: '手写分布式锁漏掉关键步骤',
        category: 'redis',
        difficulty: '资深',
        tags: ['分布式锁', '并发', 'Redisson'],
        scenario: '多个实例会并发执行同一段不能重复的逻辑（扣库存、定时任务、批处理），需要一把跨进程的锁。',
        symptom: '程序在加锁和设过期之间挂掉，锁永远不过期；业务没执行完锁先过期，被别的实例拿到；释放时删掉了别人的锁。',
        cause: '“加锁”和“设过期”如果不是一条原子命令，就有中间态；锁的 value 不带身份，释放时就没法确认是不是自己的；没有续期机制，业务耗时一超过过期时间锁就失效。',
        fix: [
          '加锁用一条命令完成：SET key value NX EX 秒数。',
          'value 放唯一标识，释放锁用 Lua 脚本先判断是不是自己的锁再删，保证原子。',
          '加上锁续期（看门狗），避免业务没执行完锁先过期。',
          '对可用性要求高的场景考虑 Redlock，或者直接用 Redisson，这些它都实现好了。'
        ],
        example: {
          lang: 'shell',
          bad: `if redis-cli SETNX lock:order 1; then      # 第 1 步：加锁
  redis-cli EXPIRE lock:order 30           # 关键：加锁和设过期是两步，中间挂掉就留下一把永不过期的锁
fi
# 释放时不判断归属，直接删：可能删掉别人的锁
redis-cli DEL lock:order`,
          good: `token=$(uuidgen)
# 关键：加锁和设过期用一条命令完成，value 带上自己的身份
redis-cli SET lock:order "$token" NX EX 30
# 释放时用 Lua 脚本先比对 value，是自己的锁才删
redis-cli EVAL "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end" 1 lock:order "$token"`
        },
        principle: '一把靠谱的锁要三样齐全：原子加锁、按身份释放、会续期。',
        related: ['eng-schedule-multi-instance', 'eng-idempotency', 'redis-penetration-breakdown']
      },
      {
        id: 'redis-big-key',
        title: '缓存里放大 key',
        category: 'redis',
        difficulty: '入门',
        tags: ['性能', '大 key', '运维'],
        scenario: '把一个几百万元素的集合、一段很长的 JSON 整个塞进一个 key。',
        symptom: '读取和删除这个 key 时 Redis 明显卡顿，其他请求跟着超时；带宽被它一个人占满，集群里数据也压在同一个节点上。',
        cause: 'Redis 执行命令是单线程的，一个大 key 的读写或删除会长时间占住主线程；value 越大，网络传输越重，集群分片也会倾斜。',
        fix: [
          '进缓存之前先评估 value 的大小，单个 key 建议小于 10KB。',
          '大 key 拆开存，比如把一个大 hash 按字段分桶；value 先压缩再放。',
          '删除大 key 用 UNLINK 代替 DEL（Redis 4.0 起支持），让删除在后台做。',
          '用 redis-cli --bigkeys 或离线分析 RDB 的工具定期排查。'
        ],
        example: {
          lang: 'shell',
          bad: `# 一个 key 存下全量商品详情，读一次就要传输整个文件
redis-cli SET catalog:all "$(cat catalog.json)"
redis-cli GET catalog:all | wc -c          # 每次读取都要传完这一整块
# 关键：用 DEL 删除大 key，主线程一直阻塞到删完为止
redis-cli DEL catalog:all`,
          good: `# 关键：按桶拆成多个小 key，每次只读写需要的那一部分
for f in catalog/part-*.json; do
  bucket=$(basename "$f" .json)
  redis-cli SET "catalog:$bucket" "$(cat "$f")" EX 86400
done
redis-cli UNLINK catalog:all        # 确实要删大 key 时用 UNLINK，在后台异步释放内存`
        },
        principle: 'value 小、key 多：进缓存前先掂量大小。',
        related: ['redis-single-thread', 'redis-eviction-policy', 'eng-load-all-data']
      },
      {
        id: 'redis-eviction-policy',
        title: '当存储用的 Redis 配了 LRU 淘汰',
        category: 'redis',
        difficulty: '入门',
        tags: ['配置', '淘汰策略', '运维'],
        scenario: 'Redis 里存的是不能丢的数据（会话、待处理任务），却沿用了缓存场景的配置；或者内存达到上限时行为和预期不一样。',
        symptom: '数据悄悄消失，没有任何报错，业务读到空值；或者反过来，内存满了之后写入直接报错。',
        cause: '内存到达 maxmemory 之后怎么办由 maxmemory-policy 决定，共八种策略。allkeys-lru 会在所有 key 里挑最久没用的淘汰；noeviction 是默认值，内存满了之后写入直接报错。把 Redis 当存储却配了缓存策略，数据就会被逐条挤掉。',
        fix: [
          '先想清楚 Redis 在你系统里是“缓存”还是“存储”。',
          '纯缓存场景推荐 allkeys-lru。',
          '只淘汰设了过期时间的 key，用 volatile-lru。',
          '当存储用就保持默认的 noeviction，内存满了报错比悄悄丢数据好。'
        ],
        example: {
          lang: 'conf',
          bad: `# 用来存待处理任务，却照抄了缓存集群的配置
maxmemory 4gb
maxmemory-policy allkeys-lru     # 关键：内存一满就淘汰 key，没设过期的数据也会被挤掉
# 数据悄悄消失，业务读到空值，却找不到任何报错
# 被淘汰的任务再也没人处理`,
          good: `# 同样是存待处理任务：当存储用，不允许悄悄丢数据
maxmemory 4gb
maxmemory-policy noeviction      # 关键：内存满了写入报错，问题暴露出来，而不是数据悄悄消失
# 同时给内存使用率配上告警，满了之前就处理
# 前提：这台实例只存不能丢的数据，不当缓存用`
        },
        principle: '先回答“它是缓存还是存储”，再配淘汰策略。',
        related: ['redis-big-key', 'redis-persistence', 'redis-avalanche']
      },
      /* ---------------- MySQL ---------------- */
      {
        id: 'mysql-index-btree',
        title: '给范围查询选哈希索引',
        category: 'mysql',
        difficulty: '进阶',
        tags: ['索引', 'B+ 树', '面试'],
        scenario: '设计索引，被问到“MySQL 的索引用 B+ 树而不是哈希表或 B 树”；或者想给等值查询的列换成哈希索引。',
        symptom: '等值查询确实快了，可一到范围查询、排序和分页，索引就用不上，只能全表扫描。',
        cause: '哈希索引等值快，但不支持范围查询和排序；B 树的数据存在每个节点上，一次 IO 读到的键少，树就更高；B+ 树的数据全在叶子节点，叶子之间有链表相连，范围查询、排序、分页都是顺着叶子链表走，而且树又矮又胖（3 层能存千万级数据），IO 次数少。这是磁盘 IO 模型决定的。',
        fix: [
          '需要范围查询、排序或分页的列，用 B+ 树索引，也就是 InnoDB 默认的索引。',
          '哈希索引只用在纯等值查询的场景。',
          '面试时从“磁盘 IO 次数”讲起：树矮、一次读到的键多，所以选 B+ 树。'
        ],
        example: {
          lang: 'sql',
          bad: `-- MEMORY 引擎默认建的是哈希索引：等值查询快，但范围查询用不上它
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  created_at DATETIME,
  INDEX idx_created (created_at) USING HASH
) ENGINE=MEMORY;

-- 关键：哈希索引不支持范围，只能全表扫描
SELECT * FROM orders
WHERE created_at >= '2026-11-01' AND created_at < '2026-12-01';`,
          good: `-- 关键：换成 B+ 树，数据全在叶子节点、叶子之间有链表，范围查询顺着走
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  created_at DATETIME,
  INDEX idx_created (created_at) USING BTREE
) ENGINE=InnoDB;

-- 走 idx_created 的范围扫描
SELECT * FROM orders
WHERE created_at >= '2026-11-01' AND created_at < '2026-12-01';`
        },
        principle: '等值才考虑哈希，范围、排序、分页一律 B+ 树。',
        related: ['mysql-leftmost-prefix', 'mysql-index-invalid', 'mysql-deep-pagination']
      },
      {
        id: 'mysql-leftmost-prefix',
        title: '联合索引不按最左前缀查询',
        category: 'mysql',
        difficulty: '入门',
        tags: ['索引', '联合索引', '最左前缀'],
        scenario: '建了 (a, b, c) 这样的联合索引，查询条件却没有从最左边的列开始，或者索引里列的顺序设计得不合理。',
        symptom: '明明有索引，EXPLAIN 出来却是全表扫描；索引建了不少，真正被用上的没几个。',
        cause: '联合索引 (a, b, c) 相当于建了 (a)、(a, b)、(a, b, c) 三个索引，查询条件必须从最左边的列开始连续命中：WHERE b = 1 AND c = 2 用不上这个索引，WHERE a = 1 AND c = 2 只能用到 a 列。',
        fix: [
          '查询条件从联合索引最左边的列开始，并保持连续。',
          '设计联合索引时，等值条件的列放前面，范围条件的列放后面。',
          '排序列紧跟等值列，让 ORDER BY 也能用上索引。'
        ],
        example: {
          lang: 'sql',
          bad: `CREATE INDEX idx_whs ON orders (warehouse_id, status, created_at);

-- 关键：跳过了最左列 warehouse_id，这个索引用不上
SELECT * FROM orders WHERE status = 'PAID' AND created_at >= '2026-11-01';

-- 带上了最左列，但中间的 status 缺失：只能用到 warehouse_id 这一列
SELECT * FROM orders WHERE warehouse_id = 3 AND created_at >= '2026-11-01';`,
          good: `CREATE INDEX idx_whs ON orders (warehouse_id, status, created_at);

-- 关键：从最左列开始连续命中，三列都能用上
SELECT * FROM orders
WHERE warehouse_id = 3 AND status = 'PAID' AND created_at >= '2026-11-01';`
        },
        principle: '联合索引从最左列开始连续命中，等值在前、范围在后。',
        related: ['mysql-index-btree', 'mysql-index-invalid', 'mysql-deep-pagination']
      },
      {
        id: 'mysql-index-invalid',
        title: '在索引列上做函数和隐式转换',
        category: 'mysql',
        difficulty: '入门',
        tags: ['索引', '隐式转换', 'EXPLAIN'],
        scenario: 'WHERE 条件里对索引列用了函数或运算、拿数字去比对字符串列，或者 LIKE 以百分号开头。',
        symptom: '索引明明建了，查询还是慢；EXPLAIN 出来 type 是 ALL，扫描行数接近全表。',
        cause: '索引里存的是列的原值。对列做函数或运算、发生隐式类型转换之后，拿去比较的已经不是索引里的那个值，优化器只能放弃索引，改走全表扫描。',
        fix: [
          '不要对索引列做函数或运算，改成对常量做处理，比如把 YEAR(create_time) = 2023 改成 create_time 落在某个范围内。',
          '参数类型和列类型保持一致，字符串列不要传数字。',
          'LIKE 不要以百分号开头。',
          'OR 的两侧都要有索引，否则整体用不上。',
          '用 EXPLAIN 检查：type 至少到 range；Extra 里出现 Using index 表示覆盖索引，不用回表。'
        ],
        example: {
          lang: 'sql',
          bad: `-- 对索引列做函数：优化器没法用 create_time 上的索引
SELECT * FROM orders WHERE YEAR(create_time) = 2026;

-- 关键：order_no 是 varchar，却拿数字去比，发生隐式类型转换，索引失效
SELECT * FROM orders WHERE order_no = 20261128001;

-- LIKE 以百分号开头，同样用不上索引
SELECT * FROM orders WHERE remark LIKE '%加急%';`,
          good: `-- 把计算挪到常量一侧，索引列保持原样
SELECT * FROM orders
WHERE create_time >= '2026-01-01' AND create_time < '2027-01-01';

-- 关键：参数类型和列类型一致，索引可以正常命中
SELECT * FROM orders WHERE order_no = '20261128001';`
        },
        principle: '让索引列保持原样：不做运算、不转类型、不用前导百分号。',
        related: ['mysql-leftmost-prefix', 'mysql-index-btree', 'eng-charset']
      },
      {
        id: 'mysql-isolation-level',
        title: '关键业务读改写不加行锁',
        category: 'mysql',
        difficulty: '资深',
        tags: ['事务', '隔离级别', '锁', '面试'],
        scenario: '配置数据库的事务隔离级别，或者在默认级别下做“先读出来、再计算、再写回”这类业务。',
        symptom: '两个事务同时读到同一个旧值，各自算完写回，后写的把先写的覆盖掉，结果像丢了一次更新。',
        cause: '四个隔离级别逐级加码：读未提交会脏读；读已提交会有不可重复读（Oracle 的默认级别）；可重复读是 MySQL 的默认级别，InnoDB 用 MVCC 加间隙锁基本解决了幻读；串行化性能差，基本不用。但可重复读下仍可能出现“更新丢失”。',
        fix: [
          '关键业务用 SELECT ... FOR UPDATE 显式加锁，不要只依赖默认隔离级别。',
          '讲清四个级别的递进关系和各自的坑，以及 InnoDB 在可重复读下是怎么用 MVCC 和间隙锁的。'
        ],
        example: {
          lang: 'sql',
          bad: `-- 可重复读下，两个事务都读到 100，各扣 30 后都写回 70：第二次扣款丢了
START TRANSACTION;
SELECT balance FROM account WHERE id = 1;      -- 读到 100（快照读）
UPDATE account SET balance = 70 WHERE id = 1;  -- 关键：把应用算出来的值整个写回，覆盖了别人的修改
COMMIT;`,
          good: `START TRANSACTION;
-- 关键：FOR UPDATE 是当前读并锁住这一行，别的事务要等这里提交或回滚之后才能改
SELECT balance FROM account WHERE id = 1 FOR UPDATE;
UPDATE account SET balance = balance - 30 WHERE id = 1;
COMMIT;`
        },
        principle: '默认隔离级别挡不住应用层的读改写，关键业务显式加锁。',
        related: ['mysql-mvcc', 'spring-tx-self-invocation', 'eng-idempotency']
      },
      {
        id: 'mysql-deep-pagination',
        title: '用大偏移量做深分页',
        category: 'mysql',
        difficulty: '进阶',
        tags: ['分页', '性能', '优化'],
        scenario: '列表页可以一直往后翻，或者导出、对账任务用 LIMIT offset, size 一页一页地把大表读完。',
        symptom: '前几页很快，越往后越慢，翻到几十万行之后每一页都要等上好几秒。',
        cause: 'LIMIT 1000000, 10 的意思是：先扫描并丢掉前 100 万行，再返回 10 行。偏移量越大，白做的功越多。',
        fix: [
          '游标方案（推荐）：记住上一页最后一条的 ID，下一页用 WHERE id > 上一页最后 ID LIMIT 10，翻到多深性能都恒定。',
          '不方便改交互时，用子查询先定位起始主键：WHERE id >= (SELECT id FROM t LIMIT 1000000, 1)。',
          '在业务上限制只能翻前 N 页，搜索引擎都是这么做的。'
        ],
        example: {
          lang: 'sql',
          bad: `-- 前几页很快，越往后越慢
SELECT id, order_no, amount FROM orders
ORDER BY id
LIMIT 1000000, 10;      -- 关键：先扫描并丢弃前 100 万行，才轮到要返回的 10 行

-- 导出任务照着这个写法一页页往后翻，越到后面每页越慢`,
          good: `-- 关键：游标分页。上一页最后一条的 id 是 1000000，直接从它之后开始取
SELECT id, order_no, amount FROM orders
WHERE id > 1000000
ORDER BY id
LIMIT 10;`
        },
        principle: '别让数据库替你数数：深分页用游标，不用大偏移量。',
        related: ['eng-load-all-data', 'mysql-leftmost-prefix', 'mysql-slow-query']
      },
      {
        id: 'mysql-mvcc',
        title: '读写并发时给普通查询加锁',
        category: 'mysql',
        difficulty: '进阶',
        tags: ['MVCC', '事务', '原理', '面试'],
        scenario: '担心读写互相影响，给普通查询也加上了锁；或者面试被问到 MVCC 的原理。',
        symptom: '读操作也要排队等写事务释放锁，并发上不去；明明只是查一下，却把别人给阻塞了。',
        cause: 'MVCC（多版本并发控制）给每行记录了事务 ID（trx_id）和回滚指针（roll_pointer），Undo log 里保留着历史版本链。普通读按 Read View 快照判断哪个版本可见，读不加锁、读写不冲突。这就是 InnoDB 能同时保证可重复读和高并发的核心机制。',
        fix: [
          '普通查询（快照读）不需要额外加锁，交给 MVCC。',
          '只有需要读到最新值并锁住行时才用 SELECT ... FOR UPDATE（当前读）。',
          '面试时按“隐藏字段、Undo log 版本链、Read View 可见性”三步讲。'
        ],
        example: {
          lang: 'sql',
          bad: `-- 只是查一下订单状态做展示，却加上了排他锁
START TRANSACTION;
SELECT status FROM orders WHERE order_no = 'SO-2026-03871' FOR UPDATE;
-- 关键：普通读被你变成了当前读，这一行被锁住
-- 后台对这张订单的更新只能排队等待
COMMIT;`,
          good: `START TRANSACTION;
-- 关键：展示类的读取用普通查询，走 MVCC 快照读，不加锁、不阻塞别人
SELECT status, amount FROM orders WHERE order_no = 'SO-2026-03871';

-- 只有确实要“读最新值并锁住再改”的业务，才用当前读
SELECT amount FROM orders WHERE order_no = 'SO-2026-03871' FOR UPDATE;
COMMIT;`
        },
        principle: '普通读靠 MVCC，不加锁；要锁才用 FOR UPDATE。',
        related: ['mysql-isolation-level', 'spring-tx-too-long']
      },
      {
        id: 'mysql-slow-query',
        title: '查询慢就直接上分库分表',
        category: 'mysql',
        difficulty: '资深',
        tags: ['性能优化', '分库分表', '缓存', 'EXPLAIN'],
        scenario: '接口变慢，第一反应是“数据量大了，该分库分表了”。',
        symptom: '架构改了一圈，慢的查询还是慢：根子是一个没走索引的 SQL，或者一次取了太多数据。',
        cause: '没弄清慢在哪就上架构，等于用更贵的手段掩盖真正的问题。分库分表、读写分离都会带来新的运维和一致性成本，过早引入只会让问题更复杂。',
        fix: [
          '先用 EXPLAIN 搞清楚慢在哪，再对症下药。',
          '四板斧按顺序试：索引（把联合索引设计对）、分区或分表（数据量级到了再上，别过早）、缓存（热点数据进 Redis，注意一致性）、读写分离（主库写、从库读）。',
          '别上来就堆架构。'
        ],
        example: {
          lang: 'sql',
          bad: `-- 查询慢，结论是“数据量大了”，开始调研分库分表
SELECT * FROM orders WHERE customer_id = 42 AND status = 'PAID';
-- 关键：没看过执行计划，customer_id 和 status 上根本没有合适的索引
-- 拆了库、分了表，单表数据少了，这条 SQL 还是全表扫描
-- 与此同时，接口还是慢，改造的排期却已经压上了团队`,
          good: `-- 关键：先看执行计划，确认是不是全表扫描
EXPLAIN SELECT * FROM orders WHERE customer_id = 42 AND status = 'PAID';

-- 对症下药：给等值条件的两列建联合索引，再比较一次
CREATE INDEX idx_customer_status ON orders (customer_id, status);`
        },
        principle: '先 EXPLAIN 搞清楚慢在哪，再对症下药，别上来就堆架构。',
        related: ['mysql-index-invalid', 'redis-cache-aside', 'mysql-deep-pagination']
      },
      {
        id: 'mysql-online-ddl',
        title: '在业务高峰期直接 ALTER 大表',
        category: 'mysql',
        difficulty: '进阶',
        tags: ['DDL', '运维', 'Online DDL'],
        scenario: '千万级的大表要加字段或加索引，随手在主库上执行了一条 ALTER。',
        symptom: '执行期间这张表的读写被元数据锁挡住，或者从库的延迟越拉越大，严重时线上超时。',
        cause: '大表的结构变更要扫描数据，耗时和表的大小成正比；变更开始和结束时都要拿元数据锁，一旦和长事务撞上，后面所有访问这张表的请求都会排队。',
        fix: [
          'MySQL 8.0 加列用 INSTANT，秒级完成。',
          '加索引用 Online DDL：ALGORITHM=INPLACE, LOCK=NONE。',
          '在低峰期执行，提前预估耗时。',
          '准备好 gh-ost 或 pt-online-schema-change 兜底，先在从库上演练一遍。'
        ],
        example: {
          lang: 'sql',
          bad: `-- 下午，直接在主库上对千万级的表执行，既没有指定算法，也没有评估耗时
ALTER TABLE orders
  ADD COLUMN channel VARCHAR(32) DEFAULT NULL,
  ADD INDEX idx_channel (channel);
-- 关键：加列和加索引写在同一条语句里，用不上 INSTANT，只能按加索引的耗时来算
-- 期间如果有长事务占着这张表，后面所有请求都会排队`,
          good: `-- 低峰期执行，先把两件事拆开。加列走 INSTANT
ALTER TABLE orders
  ADD COLUMN channel VARCHAR(32) DEFAULT NULL,
  ALGORITHM=INSTANT;                   -- 关键：8.0 的 INSTANT 加列，秒级完成

-- 加索引走 Online DDL，期间允许读写
ALTER TABLE orders ADD INDEX idx_channel (channel), ALGORITHM=INPLACE, LOCK=NONE;`
        },
        principle: '大表 DDL：选对算法、挑低峰、留后手、先演练。',
        related: ['eng-no-rollback-plan', 'mysql-slow-query', 'redis-persistence']
      },
      /* ---------------- AI 与编程 ---------------- */
      {
        id: 'ai-ai-code-review',
        title: '直接上线 AI 生成的代码',
        category: 'ai',
        difficulty: '入门',
        tags: ['AI 编程', '代码验收', '安全'],
        scenario: '让 AI 写了一段能跑通的代码，准备直接提交。',
        symptom: '常规流程没问题，一遇到空值、边界值、并发就出错；更糟的是代码里带着 SQL 拼接、硬编码密钥这类安全漏洞。',
        cause: 'AI 生成代码的验收和外包交付一个道理：能跑不等于正确。它不了解你的并发场景、数据范围和内部规范，给的是“看起来合理”的代码。',
        fix: [
          '把 AI 写的代码当成外包交付来验收：能跑不等于正确。',
          '重点盯四处：边界条件（AI 常漏空值和极端值）、并发安全（AI 不了解你的并发场景）、依赖版本（AI 可能用过时或不存在的 API）、安全漏洞（SQL 拼接、硬编码密钥）。',
          'AI 负责“写得快”，你负责“验得对”。'
        ],
        example: {
          lang: 'java',
          bad: `// AI 生成的“根据手机号查用户”：能跑通，测试也过了
public User findByPhone(String phone) {
    // 关键：把输入直接拼进 SQL。测试数据全是正常手机号，所以没发现注入风险
    String sql = "SELECT * FROM user WHERE phone = '" + phone + "'";
    return jdbcTemplate.queryForObject(sql, userRowMapper);
}`,
          good: `public User findByPhone(String phone) {
    // 验收时补上的边界校验：AI 漏掉的空值和格式不对的输入
    if (phone == null || phone.length() != 11) {
        return null;
    }
    // 关键：参数化查询，而不是把输入拼进 SQL
    String sql = "SELECT * FROM user WHERE phone = ?";
    return jdbcTemplate.queryForObject(sql, userRowMapper, phone);
}`
        },
        principle: 'AI 负责写得快，你负责验得对。',
        related: ['ai-vibe-coding-scope', 'eng-happy-path-testing', 'eng-hardcoded-config']
      },
      {
        id: 'ai-non-dev-build-product',
        title: '零基础只靠 AI 做产品',
        category: 'ai',
        difficulty: '入门',
        tags: ['AI 编程', '产品', '需求'],
        scenario: '不会写代码，想靠 AI 把想法直接做成能用的产品。',
        symptom: 'Demo 很快就出来了，但一改需求就推倒重来；出了问题不知道怎么描述，AI 越改越乱。',
        cause: '工具降低的是动手门槛，不是动脑门槛。需求说不清，AI 就只能猜；结果不会验证，错了也看不出来。',
        fix: [
          '把需求说清楚：说不清楚，再强的工具也做不对。',
          '会验证结果：拿测试数据跑，知道什么是对、什么是错。',
          '出问题会描述：报错截图、复现步骤、预期结果和实际结果。',
          '把它当成做出 Demo 的捷径，别指望它替你完成产品。'
        ],
        example: {
          lang: 'text',
          bad: `你：帮我做一个记账软件，功能全一点，界面好看一点
AI：给出了一大段代码，跑起来像个样子
你：不是这个意思，我要的是能多人一起记账的
AI：改了一大半，之前的账单导入功能没了
结果：Demo 能演示，一提新需求就推倒重来`,
          good: `你：做一个网页版记账工具，只做三件事：录入一笔收支（金额、日期、分类）、按月汇总、导出 CSV
你：用“金额为负数”和“分类为空”这两组数据各试一次，告诉我应该得到什么
你：导出的文件用 Excel 打开是乱码。复现：录入一条后点导出。预期是中文表头，实际是乱码
结果：每一轮改动都能验证，功能是累加的，而不是推倒重来
原则：需求说清楚、结果会验证、问题会描述`
        },
        principle: 'AI 降低的是动手门槛，降低不了动脑门槛。',
        related: ['career-clarify-requirements', 'ai-vibe-coding-scope', 'eng-charset']
      },
      {
        id: 'ai-replacement-anxiety',
        title: '把 AI 当成对手而不是工具',
        category: 'ai',
        difficulty: '入门',
        tags: ['职业', '趋势', 'AI 编程'],
        scenario: '看到 AI 写代码的新闻，开始焦虑要不要转行，或者干脆拒绝在工作中使用 AI。',
        symptom: '一边焦虑，一边照旧按老办法干活；同事用 AI 把重复劳动甩掉了，自己的产出节奏慢慢落后。',
        cause: 'AI 替代的是“把明确需求翻译成代码”的部分，而需求本身的澄清、系统的架构取舍、线上故障的定位修复，依赖对业务和系统的深度理解，这些是 AI 短期给不了的。',
        fix: [
          '把 AI 当工具用起来，把省下的时间花在理解业务和系统上。',
          '守住判断力：AI 能给方案，判断哪个方案适合你的场景，还是你。',
          '认清真实的差距不是 AI 本身，而是“会用 AI 的程序员”和“不会用 AI 的程序员”之间的效率差。'
        ],
        principle: '真实威胁不是 AI，是会用 AI 的程序员对不会用 AI 的程序员的效率碾压。',
        related: ['ai-keep-learning-java', 'career-ai-vs-coder', 'ai-algorithm-basics']
      },
      {
        id: 'ai-vibe-coding-scope',
        title: '在生产核心系统上 vibe coding',
        category: 'ai',
        difficulty: '进阶',
        tags: ['vibe coding', 'AI 编程', '架构'],
        scenario: '尝到了 AI 写代码的甜头，想把同样的方式用到所有项目上。',
        symptom: '原型阶段很爽，上了生产之后一出问题就抓瞎：代码没人读过，排查连抓手都没有。',
        cause: 'vibe coding 的前提是试错成本低、反馈快。涉及资金、隐私、长期维护的核心系统，出错代价高，要求每一行代码都能解释、能排查，这和“AI 怎么写我同意”是冲突的。',
        fix: [
          '适合的场景：原型验证、个人小工具、一次性脚本、Demo 演示，试错成本低、反馈快。',
          '不适合的场景：涉及资金或隐私的生产系统、长期维护的核心业务、高并发场景。',
          '按场景区分，抵制和神化都不对。'
        ],
        principle: 'vibe coding 只用在试错成本低的地方。',
        related: ['ai-ai-code-review', 'ai-non-dev-build-product', 'career-architect-thinking']
      },
      {
        id: 'ai-rpa-vs-agent',
        title: 'RPA 和 AI Agent 选型跟风',
        category: 'ai',
        difficulty: '进阶',
        tags: ['RPA', 'AI Agent', '自动化', '选型'],
        scenario: '做企业自动化，要在 RPA 和 AI Agent 之间选一个，或者听人说 Agent 会取代 RPA。',
        symptom: '规则明确的流程交给 Agent，结果不稳定；需要灵活判断的场景交给 RPA，一遇到例外就中断。',
        cause: 'RPA 是“教机器人按固定规则点鼠标”，确定性高但脆弱，界面一改就失效；AI Agent 是“给目标让它自己规划”，灵活但结果不确定。两者的强弱项正好互补。',
        fix: [
          '规则明确的流程用 RPA，稳。',
          '非标准场景用 AI Agent，活。',
          '选型看场景对确定性的要求，而不是追新。',
          '企业自动化短期内两者共存。'
        ],
        example: {
          lang: 'text',
          bad: `需求：每天从供应商门户下载对账单，字段固定、路径固定
判断：没有先想清楚它属于哪一类任务
选型：上 AI Agent，因为最近都在聊它
理由：新东西总比旧东西好
结果：选型理由和场景没有任何关系，步骤走得对不对全靠运气`,
          good: `需求：每天从供应商门户下载对账单，字段固定、路径固定
判断：这是规则明确的流程，要求结果确定
选型：RPA，按固定规则操作
另一类需求：从格式各异的合同里提取关键条款，这是非标准场景，才考虑 AI Agent
兜底：门户改版导致步骤失败时，截图留证并通知人工处理`
        },
        principle: '选型看场景对确定性的要求，而不是追新。',
        related: ['eng-rpa-selector', 'career-automation-tooling', 'career-approval-flow']
      },
      {
        id: 'ai-keep-learning-java',
        title: '追热点换掉手里的主技术栈',
        category: 'ai',
        difficulty: '入门',
        tags: ['职业', '学习', 'Java'],
        scenario: '看到“AI 都会写代码了”“某门语言才是未来”的说法，犹豫要不要放下手里学了一半的技术栈去追新方向。',
        symptom: '换了赛道从头开始，热点一过又要再换一次；哪一门都只学了皮毛。',
        cause: 'AI 能写代码，但架构取舍、性能瓶颈定位、业务建模这些“系统级判断”依然稀缺，而它们要建立在对一门技术的扎实理解上。Java 生态（Spring、MySQL、Redis）至今仍是国内企业级开发的基本盘。',
        fix: [
          '别追热点换赛道，把手里这门学扎实。',
          '把时间投到架构取舍、性能瓶颈定位、业务建模这些系统级判断上。',
          '把 AI 当放大器：基础越扎实，AI 给的东西你越能用得准。'
        ],
        principle: '把手里这门学扎实的人，到哪儿都有饭吃。',
        related: ['career-depth-first', 'ai-replacement-anxiety', 'career-learning-spring']
      },
      {
        id: 'ai-llm-cost',
        title: '大模型调用不计成本',
        category: 'ai',
        difficulty: '进阶',
        tags: ['大模型', '成本', 'API'],
        scenario: '应用里要调用大模型 API，上线前没有算过一次调用多少钱、一天会调多少次。',
        symptom: '账单超出预期，回过头查才发现是上下文越堆越长、什么任务都用了最贵的模型。',
        cause: '成本等于“单次调用的 token 数 × 单价 × 调用次数”，三个因子一个都没人管。',
        fix: [
          '先算清楚单次调用成本乘以调用量，再定架构。',
          '模型分级：简单任务用小模型，复杂推理才上旗舰模型。',
          '控制上下文：历史对话做裁剪或摘要，别无限堆积 token。',
          '结果缓存：相同的输入直接返回，不再调用。',
          '非实时场景用批量接口（batch API），价格比实时调用低，具体以厂商当时公布的价格为准。'
        ],
        example: {
          lang: 'java',
          bad: `// 历史对话全量带上，模型一律选最贵的
List<Message> history = loadAllMessages(userId);           // 聊了几十轮，上下文越堆越长
// 关键：一个“今天星期几”的问题，也走旗舰模型加全量历史
client.chat("flagship-model", history, question);
// 相同的问题每次都重新调用，没有缓存`,
          good: `// 关键：先查缓存，同样的问法直接返回，不再调用
Answer cached = cache.get(question);
if (cached != null) return cached;

// 历史只留最近几轮，更早的压成摘要
List<Message> brief = summarizeIfNeeded(loadRecent(userId, 6));
String model = isComplex(question) ? "flagship-model" : "lite-model";   // 按任务难度选模型
client.chat(model, brief, question);`
        },
        principle: '先算账再定架构：token 数、单价、调用次数都要管。',
        related: ['eng-hardcoded-config', 'redis-cache-aside', 'ai-vibe-coding-scope']
      },
      {
        id: 'ai-algorithm-basics',
        title: '有 AI 就不用练算法基础',
        category: 'ai',
        difficulty: '入门',
        tags: ['算法', '学习', '面试'],
        scenario: '准备面试，或者犹豫要不要花时间刷算法题、学数据结构，反正 AI 能写。',
        symptom: '面试还是考；更要命的是 AI 给出两个方案，你判断不了哪个适合当前场景。',
        cause: '刷题的目的变了：从“背解法”变成“训练把问题结构化的思维”。数据结构选型、复杂度权衡，AI 能给你方案，但判断哪个方案适合你的场景，还是你。',
        fix: [
          '面试还考，就还得刷，但目标换成训练结构化思维。',
          '把数据结构选型和复杂度权衡当成重点，而不是背题。',
          '基础打牢，不然 AI 给的代码你连对错都看不出来。'
        ],
        principle: '刷题练的是把问题结构化的思维，这个判断 AI 替不了。',
        related: ['career-ds-in-practice', 'career-degree-gap', 'ai-keep-learning-java']
      },
      /* ---------------- 工程实践 ---------------- */
      {
        id: 'eng-idempotency',
        title: '接口不做幂等',
        category: 'engineering',
        difficulty: '进阶',
        tags: ['幂等', '接口设计', '重试', '消息'],
        scenario: '下单、支付、发券这类“只能做一次”的接口，调用方会重试，或者走消息队列、经过网关重试。',
        symptom: '用户只点了一下，却生成了两笔订单；消息重投了一次，积分就多加一次。',
        cause: '前端重复点击、网关重试、消息重投，都会让同一个请求到达两次。服务端如果只按“收到请求”就处理，分不清这是新请求还是上一次的重发。',
        fix: [
          '调用方每次发起业务时带一个唯一的幂等键（比如订单号或 UUID），同一个业务的多次请求用同一个键。',
          '服务端用幂等键加唯一约束兜底：重复插入直接失败，然后返回第一次的处理结果。',
          '有状态流转的业务，用状态机限制状态流转，比如“已支付”的订单不允许再支付一次。'
        ],
        example: {
          lang: 'java',
          bad: `@PostMapping("/pay")
public Result pay(@RequestBody PayRequest req) {
    // 网关超时重试时，同一个请求会进来两次
    Order order = orderMapper.selectById(req.getOrderId());
    orderService.deductBalance(order);            // 关键：没有幂等键，余额被扣了两次
    payRecordMapper.insert(new PayRecord(req));   // 支付记录也多了一条
    return Result.ok();
}`,
          good: `@PostMapping("/pay")
public Result pay(@RequestBody PayRequest req) {
    try {
        payService.payOnce(req);         // 事务方法：插入支付记录和扣款，要么都成功，要么都回滚
    } catch (DuplicateKeyException e) {
        return Result.ok();              // 关键：幂等键上有唯一约束，重复请求被拦下，按成功返回
    }
    return Result.ok();
}
// pay_once 表的 pay_id 是唯一索引，值就是调用方传来的幂等键，同一笔支付的多次请求用同一个键`
        },
        principle: '凡是可能重发的请求，都要有一个能认出“这是重发”的键。',
        related: ['spring-remote-call-timeout', 'eng-schedule-multi-instance', 'mysql-isolation-level']
      },
      {
        id: 'eng-schedule-multi-instance',
        title: '定时任务在多实例上重复跑',
        category: 'engineering',
        difficulty: '进阶',
        tags: ['定时任务', '分布式锁', '部署'],
        scenario: '服务从单实例改成多副本部署，实例上还跑着 @Scheduled 定时任务。',
        symptom: '原来一天跑一次的对账，现在跑了好几遍：通知发了好几轮，或者数据被重复累加。',
        cause: '定时任务是由每个实例自己触发的。部署了几个副本，到了时间点就有几个实例同时执行同一段逻辑。',
        fix: [
          '把调度收敛到单独的实例：只有一个实例带调度配置，其余实例不加载定时任务。',
          '或者用分布式锁（如 Redis 的 SET NX）保证同一时刻只有一个实例执行。',
          '或者接一个调度中心，由它统一触发，并决定交给哪个实例执行。'
        ],
        example: {
          lang: 'java',
          bad: `@Scheduled(cron = "0 0 2 * * *")
public void dailyReconcile() {
    // 关键：部署了多个副本之后，这段逻辑到了点会被每个实例各执行一遍
    billService.reconcileYesterday();
    notifyService.sendSummary();           // 通知因此被重复发送
}`,
          good: `@Scheduled(cron = "0 0 2 * * *")
public void dailyReconcile() {
    // 关键：抢到锁的实例才执行，其余实例到点直接返回
    Boolean locked = redisTemplate.opsForValue()
            .setIfAbsent("lock:reconcile", instanceId, Duration.ofMinutes(30));
    if (!Boolean.TRUE.equals(locked)) return;
    try {
        billService.reconcileYesterday();
        notifyService.sendSummary();
    } finally {
        lockRegistry.release("lock:reconcile", instanceId);   // 按身份释放，不要删掉别人的锁
    }
}`
        },
        principle: '多副本部署之后，“到点执行”要变成“到点只有一个执行”。',
        related: ['redis-distributed-lock', 'eng-idempotency', 'spring-non-web-app']
      },
      {
        id: 'eng-load-all-data',
        title: '一次性加载全量数据',
        category: 'engineering',
        difficulty: '入门',
        tags: ['内存', '批量处理', '性能'],
        scenario: '导出、对账、批量发消息这类任务，为了省事把整张表读进内存再逐条处理。',
        symptom: '测试环境数据少，一切正常；上线之后数据一涨就内存溢出，任务一跑，整个服务跟着重启。',
        cause: '内存的量是固定的，表的数据是会涨的。一次读全量，数据量超过可用内存的那一天，就是 OutOfMemoryError 的那一天。',
        fix: [
          '分批查询：每次只取一批（比如 1000 条），用主键游标往后翻。',
          '数据量大时用流式处理，读一条处理一条，不要先把结果攒进集合。',
          '处理过程中及时释放不再使用的对象引用。'
        ],
        example: {
          lang: 'java',
          bad: `public void resendAll() {
    // 关键：一张几千万行的表整个读进内存，数据一涨就 OutOfMemoryError
    List<Message> all = messageMapper.selectList(null);
    for (Message m : all) {
        mqProducer.send(m);
    }
}`,
          good: `public void resendAll() {
    long lastId = 0;
    while (true) {
        // 关键：每次只取一页，处理完记住最后一条的主键，从这里继续往后取
        List<Message> batch = messageMapper.selectAfter(lastId, 1000);
        if (batch.isEmpty()) break;
        for (Message m : batch) {
            mqProducer.send(m);
        }
        lastId = batch.get(batch.size() - 1).getId();
    }
}`
        },
        principle: '数据会涨，内存不会：分批取、流式处理、随手释放。',
        related: ['mysql-deep-pagination', 'java-null-for-gc', 'redis-big-key']
      },
      {
        id: 'eng-no-rollback-plan',
        title: '上线没有回滚方案',
        category: 'engineering',
        difficulty: '资深',
        tags: ['发布', '回滚', '灰度', '数据库变更'],
        scenario: '新版本准备发布，既改了接口也改了表结构，但没人想过发布失败了怎么退回。',
        symptom: '上线后出了问题，想回退代码，却发现旧代码跑在新表结构上报错；或者上一版可以直接部署的包已经找不到了。',
        cause: '回滚不是一个按钮，而是一串事先设计好的退路：代码能不能退、数据能不能退、流量能不能切回去。等到出事再想，每一步都是障碍。',
        fix: [
          '数据库变更和代码保持向前兼容：先加字段、不删旧字段，旧代码在新表结构上也要能跑。',
          '保留上一个版本可直接部署的包，并且确认它真的能启动。',
          '先灰度：放一小部分流量到新版本，观察指标没问题再全量。',
          '发布清单里写明回滚步骤和触发条件：谁来决定回滚、多久之内必须回滚。'
        ],
        example: {
          lang: 'shell',
          bad: `# 上线当天：停掉全部实例，直接执行改表脚本，再启动新版本
# 关键：把 amount 字段直接改名，旧版本代码还在读这个字段，想回退也起不来
mysql -h db.internal -u app order_db < migration.sql
kubectl set image deploy/order order=registry.internal/order:latest
# 出了问题想回退，才发现旧版本的镜像早被覆盖了`,
          good: `# 发布前：上一版的镜像还在仓库里，随时可以部署回去
docker pull registry.internal/order:v1.4.2

# 关键：表结构向前兼容。只新增 total_amount，amount 保留到下一版再删，旧代码照样能跑
mysql -h db.internal -u app order_db < migration.sql

# 发布时先灰度一小部分实例，指标正常再全量；出问题就切回 v1.4.2`
        },
        principle: '发布前先回答“怎么退回去”，答不上来就不要发。',
        related: ['mysql-online-ddl', 'spring-premature-microservices', 'eng-happy-path-testing']
      },
      {
        id: 'eng-hardcoded-config',
        title: '配置硬编码',
        category: 'engineering',
        difficulty: '入门',
        tags: ['配置', '环境变量', '密钥', '安全'],
        scenario: '数据库地址、第三方接口地址、开关、密钥，直接写在代码里或者打进制品的配置文件里。',
        symptom: '换个环境就要改代码、重新打包；测试环境的配置被带上了生产；密钥进了代码仓库，想换一轮要改所有用到的地方。',
        cause: '代码和“随环境变化的值”绑在了一起。环境有开发、测试、生产好几套，代码只有一份；密钥写进仓库，就等于对所有能看到仓库的人公开。',
        fix: [
          '配置外置：按环境放到配置文件、配置中心或环境变量里，代码里只读不写。',
          '密钥走环境变量或专门的密钥管理服务，不要进代码仓库。',
          '把“哪些值会随环境变”列出来，作为提交前的检查项。'
        ],
        example: {
          lang: 'yaml',
          bad: `# 打进 jar 包的 application.yml：地址和密钥都写死在这里
sms:
  url: http://sms-gateway.test.internal/send
  # 关键：密钥明文进了代码仓库
  access-key: 3f9a1c7e2b8d4065a1c9f0e7b2d8351c
  enabled: true
# 换个环境就得改这个文件、重新打包`,
          good: `# 代码仓库里的配置只写“从哪里读”，具体数值由部署环境注入
sms:
  url: \${SMS_GATEWAY_URL}
  # 关键：密钥不进仓库，由环境变量或密钥管理服务注入
  access-key: \${SMS_ACCESS_KEY}
  enabled: \${SMS_ENABLED:false}`
        },
        principle: '会随环境变的值都不进代码，密钥永远不进仓库。',
        related: ['eng-timezone', 'spring-autoconfigure-blind', 'ai-ai-code-review']
      },
      {
        id: 'eng-charset',
        title: '文件读写不指定字符集',
        category: 'engineering',
        difficulty: '入门',
        tags: ['编码', 'UTF-8', '乱码'],
        scenario: '读写文本文件、转换流、解析别人传来的 CSV，调用 API 时没有传字符集参数。',
        symptom: '本地 Windows 上开发没问题，部署到 Linux 之后中文成了乱码；GBK 的文件按 UTF-8 读，一大半内容看不懂。',
        cause: '不指定字符集时，用的是平台的默认编码。中文 Windows 默认是 GBK，Linux 多是 UTF-8，同一个程序在两边按不同的规则解码，结果自然不一样。',
        fix: [
          '所有读写显式指定 UTF-8：new String(bytes, StandardCharsets.UTF_8)、getBytes(StandardCharsets.UTF_8)，InputStreamReader 带上编码参数。',
          '和外部系统约好用同一种编码；对方给的确实是 GBK 文件（比如 Excel 导出的 CSV）时，按它的实际编码读。',
          '不要依赖“平台默认编码恰好是 UTF-8”，每一个读写入口都写明。'
        ],
        example: {
          lang: 'java',
          bad: `public String readConfig(File file) throws IOException {
    byte[] bytes = Files.readAllBytes(file.toPath());
    // 关键：没指定字符集，用的是平台默认编码，Windows 和 Linux 上结果不一样
    return new String(bytes);
}
// 本地开发（Windows）正常，部署到 Linux 之后中文成了乱码`,
          good: `public String readConfig(File file) throws IOException {
    byte[] bytes = Files.readAllBytes(file.toPath());
    // 关键：读写都显式指定 UTF-8，不依赖平台默认编码
    return new String(bytes, StandardCharsets.UTF_8);
}
// 写文件同理：Files.write(path, text.getBytes(StandardCharsets.UTF_8))
// 接收请求流：new InputStreamReader(request.getInputStream(), StandardCharsets.UTF_8)`
        },
        principle: '每一处读写都写明 UTF-8，别让平台替你决定。',
        related: ['eng-timezone', 'mysql-index-invalid', 'ai-non-dev-build-product']
      },
      {
        id: 'eng-timezone',
        title: '时间与时区处理不当',
        category: 'engineering',
        difficulty: '进阶',
        tags: ['时间', '时区', '序列化'],
        scenario: '服务器、数据库、浏览器不在同一个时区；接口里要传输时间；跨零点、跨时区做统计和比较。',
        symptom: '同一笔订单，列表页和详情页显示的时间差了 8 小时；“今天”的统计结果和用户看到的对不上。',
        cause: '时间戳本身是一个绝对时刻，只有带上时区才能变成“几点几分”。各方对“这个值是哪个时区的时间”理解不一致，或者序列化的格式不统一，就会出现偏差。',
        fix: [
          '统一存储时区：数据库、服务器、JVM 按同一个时区配置，常见做法是全部用 UTC，或者全部用东八区。',
          '存储用时间戳或者带时区的类型，不要存“不带时区的时间字符串”。',
          '接口传输用带时区的标准格式，比如 ISO 8601 的 2026-11-28T09:30:00+08:00。',
          '展示时再按用户所在的时区转换。'
        ],
        example: {
          lang: 'java',
          bad: `// 按服务器本地时区格式化成字符串存库，没有写明这是哪个时区的时间
String now = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
orderMapper.updateCreatedAt(orderId, now);
// 关键：服务器按 UTC 运行，数据库和报表却按东八区理解这个字符串，差了 8 小时
// 用户看到的下单时间，和他在页面上实际操作的时间对不上`,
          good: `// 统一用带时区的对象：表示一个绝对时刻，不依赖服务器的时区设置
ZonedDateTime now = ZonedDateTime.now(ZoneId.of("Asia/Shanghai"));

// 关键：对外传输用带时区的 ISO 8601 格式，谁拿到都知道这是哪个时区的时间
String createdAt = now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);   // 2026-11-28T09:30:00+08:00
orderMapper.updateCreatedAt(orderId, createdAt);`
        },
        principle: '存绝对时刻，传带时区的格式，展示时再换算。',
        related: ['eng-charset', 'eng-request-trace']
      },
      {
        id: 'eng-request-trace',
        title: '日志里找不到一次请求',
        category: 'engineering',
        difficulty: '进阶',
        tags: ['日志', '排查', '链路追踪'],
        scenario: '用户反馈“下单失败”，需要把网关、订单、库存、支付几个服务的日志串起来看。',
        symptom: '每个服务的日志都有一大堆，却分不清哪些属于这一次请求；只能靠时间戳去凑，并发一高就对不上。',
        cause: '日志只记了“发生了什么”，没记“属于哪一次请求”。跨了进程之后，各个服务的日志彼此孤立，缺一个能把它们串起来的标识。',
        fix: [
          '在入口（网关或第一个服务）为每次请求生成一个请求标识（如 traceId）。',
          '全链路透传：放进 HTTP 头、RPC 上下文或消息属性里，传给每一个下游。',
          '每条日志都带上这个标识，出问题之后按标识一搜就是整条链路。',
          '把这个标识返回给前端或写进报错信息，用户反馈时带着它。'
        ],
        example: {
          lang: 'java',
          bad: `// 排查“下单失败”：三条日志分散在三个服务里，没有东西能把它们串起来
log.info("订单创建开始，orderNo={}", orderNo);
log.info("库存扣减完成，orderNo={}", orderNo);
log.error("支付回调失败，orderNo={}", orderNo);
// 关键：日志里没有“这是哪一次请求”，只能靠时间戳去猜`,
          good: `// 入口（网关或第一个服务）生成请求标识，放进 MDC；日志格式里加上 %X{traceId}
String traceId = Optional.ofNullable(request.getHeader("X-Trace-Id"))
        .orElseGet(() -> UUID.randomUUID().toString());
MDC.put("traceId", traceId);
response.setHeader("X-Trace-Id", traceId);     // 返回给调用方，用户反馈时把它带上
// 关键：之后每条日志都自动带着 traceId，按它一搜就是整条链路
log.info("订单创建开始，orderNo={}", orderNo);`
        },
        principle: '一次请求一个标识，从入口带到最下游。',
        related: ['java-swallow-exception', 'spring-event-sync', 'career-debug-mindset']
      },
      {
        id: 'eng-rpa-selector',
        title: 'RPA 选择器一改就失效',
        category: 'engineering',
        difficulty: '入门',
        tags: ['RPA', '自动化', '可维护性'],
        scenario: '用录制或半自动的方式生成 RPA 流程，上线之后目标系统的界面改版了。',
        symptom: '昨天还能跑的流程，今天在某个点击步骤报“找不到元素”，而且没人说得清它卡在了哪一屏。',
        cause: '录制出来的选择器往往依赖自动生成的 ID（每次打开都可能变），或者界面上的文字（改个文案就变）。界面一变，机器人就找不到它要操作的元素。',
        fix: [
          '能走接口就不要点界面：优先调用系统提供的 API，稳定且快。',
          '必须操作界面时，选择稳定的属性做锚点，比如固定的 id、name、data 属性，而不是自动生成的 ID 或显示文字。',
          '给关键步骤留下失败截图，出错之后能快速判断卡在了哪一屏。'
        ],
        example: {
          lang: 'text',
          bad: `操作：每天从供应商门户下载对账单
点击按钮  selector: #ext-gen-1287          # 自动生成的 ID，页面每刷新一次就可能变
点击菜单  text: 订单管理（12）              # 关键：文案里带了数量，数量一变就找不到
点击按钮  selector: /html/body/div[2]/div/span[3]/button   # 绝对路径，界面一改版就失效
结果：门户改版当天流程静默中断，没人知道卡在了哪一屏`,
          good: `操作：每天从供应商门户下载对账单
首选      调用门户的“对账单查询”接口，拿到数据直接写表      能走接口就不点界面
点击按钮  selector: button[data-action="export"]   # 关键：用稳定的属性做锚点，改版后一般不变
点击菜单  selector: nav a[href="/orders"]           # 用链接地址，而不是显示文字
兜底      每个关键步骤失败时自动截图，存到当天的目录，出错后一眼能看出卡在哪一屏`
        },
        principle: '能走接口就不点界面；非点不可，就选稳定的锚点并留下证据。',
        related: ['ai-rpa-vs-agent', 'career-automation-tooling', 'eng-happy-path-testing']
      },
      {
        id: 'eng-happy-path-testing',
        title: '只测正常流程',
        category: 'engineering',
        difficulty: '进阶',
        tags: ['测试', '边界值', '并发', '质量'],
        scenario: '写完功能，拿一条正常数据点一遍没报错，就提测了。',
        symptom: '上线之后在空值、极值、重复提交、依赖方超时这些情况下出错，而这些恰恰是测试时从没试过的路径。',
        cause: '“一切顺利”只是系统运行状态里的一小部分。真实数据里有空值、有超长字段、有并发，依赖方也会超时和失败。只测顺利的路径，等于只验证了一小部分。',
        fix: [
          '给每类输入补边界值用例：空、零、负数、最大长度、特殊字符。',
          '补依赖方失败的用例：超时、返回错误码、返回空结果时，系统怎么处理。',
          '补并发用例：同一个请求同时到达两次，会不会重复处理。',
          '把这些用例固化成自动化测试，改代码之后能反复跑。'
        ],
        example: {
          lang: 'java',
          bad: `@Test
void calculatesFeeForNormalOrder() {
    Order order = new Order("SKU-1", 2, new BigDecimal("99.00"));
    Money fee = feeService.calculate(order);
    // 关键：只验证了一条正常数据，空值、零数量、依赖方失败都没有试过
    assertEquals(new BigDecimal("9.90"), fee);
}`,
          good: `@Test
void calculatesFeeForNormalOrder() { /* 原来的用例保留 */ }

// 关键：边界值。数量为 0 时结果是什么
@Test
void returnsZeroFeeWhenQuantityIsZero() {
    Order order = new Order("SKU-1", 0, new BigDecimal("99.00"));
    assertEquals(BigDecimal.ZERO, feeService.calculate(order));
}

// 依赖方失败：汇率服务超时的时候，是报错还是用上一次的汇率
@Test
void failsFastWhenRateServiceTimesOut() { /* 让汇率服务超时，断言返回的是明确的错误 */ }`
        },
        principle: '正常路径只验证了一小部分，出问题的从来都是另一部分。',
        related: ['ai-ai-code-review', 'eng-idempotency', 'career-clarify-requirements']
      },
      /* ---------------- 职场成长 ---------------- */
      {
        id: 'career-degree-gap',
        title: '把薪资差距全归因于学历',
        category: 'career',
        difficulty: '入门',
        tags: ['求职', '学历', '应届生'],
        scenario: '应届生找工作，看到身边人的薪资差距很大，想知道差距到底从哪里来。',
        symptom: '把精力都花在焦虑学历上，简历上却拿不出像样的实习和项目，面试时讲不出自己做过什么。',
        cause: '学历是入场券，决定你进哪扇门；进了门之后的差距来自三样东西：实习经历、项目深度、面试准备。',
        fix: [
          '在校生尽早去实习，两段像样的实习能抹平学校牌子上的劣势。',
          '把一个技术方向学透，项目要能讲清“做过什么”，而不是“会什么”。',
          '面试准备三件事一起抓：基础知识、算法题、项目复盘。',
          '最该做的不是焦虑学历，是尽早实习，把一个方向学透。'
        ],
        example: {
          lang: 'text',
          bad: `求职困惑：我不是名校毕业，是不是再怎么准备也没用
简历：熟练掌握 Java、MySQL、Redis、Spring、Docker、K8s，只写了“会用什么”
行动：反复刷“学历重要吗”的帖子，项目一个都没动手
面试：被问到“做过什么”，讲不出一个完整的项目
结果：学历改不了，能改的三样东西一样没动`,
          good: `判断：学历决定进哪扇门，门后的差距看实习、项目和面试表现
简历：独立完成订单对账工具，日处理约 3 万条流水，把人工核对从半天缩短到 10 分钟，写清“做过什么、结果如何”
行动：尽早找一段实习；把手里的项目从“跑得起来”改到“讲得清楚”
面试：基础知识、算法题、项目复盘三件事一起准备
结果：学历改不了，能改的三样东西都拿得出来`
        },
        principle: '学历是入场券，进门之后看的是实习、项目和面试。',
        related: ['career-interview-structure', 'ai-algorithm-basics', 'career-depth-first']
      },
      {
        id: 'career-interview-structure',
        title: '面试答题没有结构',
        category: 'career',
        difficulty: '入门',
        tags: ['面试', '表达', '求职'],
        scenario: '面试时被问到一个会答的问题，却越说越乱；或者被问到不会的问题，不知道怎么接。',
        symptom: '答了几分钟，面试官没听到结论是什么；一紧张就想到哪说到哪。',
        cause: '紧张的本质是没有结构。脑子里没有固定的回答顺序，一到压力之下就只剩想到什么说什么。',
        fix: [
          '答题前默念“结论、理由、例子”三段式，先把结论说出来。',
          '不会的问题讲思路而不是硬编：说清这块没实际用过，但理解它要解决什么问题。',
          '每场面试之后复盘，对照录音记下答乱的地方。',
          '紧张会随着准备的充分程度明显下降。'
        ],
        example: {
          lang: 'text',
          bad: `问：你说说 HashMap 的原理吧
答：呃，它是个数组，然后里面是链表，不对，1.8 之后有红黑树了，还有扩容，
    哦对还有 hash，我上次好像还遇到过一个 bug……
（说了几分钟，面试官没听到结论，也不知道你到底掌握了多少）
问（追问）：那它线程安全吗？答：这个……应该是安全的吧？`,
          good: `问：你说说 HashMap 的原理吧
答（结论）：它用数组加链表、链表过长转红黑树来存键值对，查询的平均复杂度接近常数。
答（理由）：键的 hash 决定落在数组的哪一格，冲突时在那一格的链表上找，所以 hash 要尽量分散。
答（例子）：数据量大了会扩容，JDK 8 扩容时元素要么留在原位，要么挪到原下标加旧容量的位置。
问（追问）：那它线程安全吗？答（结论）：不安全，并发场景要换 ConcurrentHashMap。`
        },
        principle: '先说结论，再讲理由，最后给例子。',
        related: ['career-degree-gap', 'java-hashmap-concurrent']
      },
      {
        id: 'career-depth-first',
        title: '入行头三年什么都学一点',
        category: 'career',
        difficulty: '资深',
        tags: ['成长', '学习', '职业规划'],
        scenario: '刚入行，看到什么火就想学什么，每个方向都浅尝辄止。',
        symptom: '几年下来简历上列了一长串技术，没有一个能讲到原理和取舍；遇到深入的问题就答不上来。',
        cause: '头几年是打地基的窗口：把一门技术栈打穿，换来的是可以迁移到别的技术上的理解力。东一榔头西一棒子，攒下的只是名词。',
        fix: [
          '前三年深度优先，把一门技术栈打穿，别东一榔头西一棒子。',
          '写文档、记笔记，知识不沉淀等于没学。',
          '多看优秀的代码：团队里的老模块、开源项目，代码品味是看出来的。',
          '主动要活，尤其是核心模块的活。',
          '身体是最长跑的本钱。'
        ],
        principle: '前三年把一门打穿，深度带来的是可以迁移的理解力。',
        related: ['ai-keep-learning-java', 'career-learning-spring', 'career-architect-thinking']
      },
      {
        id: 'career-architect-thinking',
        title: '只管把活干完，不问为什么这么设计',
        category: 'career',
        difficulty: '资深',
        tags: ['架构', '成长', '技术方案'],
        scenario: '接到需求就开写，活干完了就算完成；想做架构师，却不知道从哪里开始练。',
        symptom: '需求完成得不错，但说不清为什么这么设计、还有没有别的做法；写出来的技术方案只是一份步骤清单。',
        cause: '架构师的核心能力不是“会用更多框架”，而是三个转换：把业务语言翻译成技术方案、在多种约束（成本、时间、人力、风险）里做取舍、对系统的长期演化负责。多数人卡在“把活干完”的执行层，没有刻意训练“为什么这么设计”的思考习惯。',
        fix: [
          '每做一个技术方案，多问一句：还有没有别的做法，代价是什么。',
          '练习把业务诉求翻译成技术方案，再讲回给提需求的人听。',
          '做方案时把约束列出来（成本、时间、人力、风险），说清为什么选了这一种。',
          '开始对系统的长期演化负责，而不只是对这一次迭代负责。'
        ],
        principle: '每个技术方案多问一句：还有没有别的做法，代价是什么。',
        related: ['career-depth-first', 'spring-premature-microservices', 'career-workflow-engine']
      },
      {
        id: 'career-useful-comments',
        title: '注释逐行翻译代码',
        category: 'career',
        difficulty: '入门',
        tags: ['注释', '代码质量', '可读性'],
        scenario: '团队要求“代码要有注释”，于是给每一行都补上一句中文说明。',
        symptom: '注释比代码还长，却没有回答“为什么这么写”；代码一改，注释没跟着改，反而误导人。',
        cause: '代码本身已经表达了“是什么”，逐行翻译只是把它再说一遍。读者真正需要的是代码里看不出来的东西：这个值为什么是它、这里为什么要绕一下。',
        fix: [
          '注释解释“为什么”，而不是“是什么”。',
          '必须写注释的三处：魔法值的含义、绕过某个坑的原因、对外接口的契约。',
          '不用写逐行翻译代码的注释。',
          '更进一步用重构让代码自解释：好命名加小函数，注释量自然就降下来了。'
        ],
        example: {
          lang: 'java',
          bad: `// 把订单价格赋值给 price 变量
int price = order.getPrice();
// 如果 price 大于 100
if (price > 100) {
    // 关键：逐行翻译代码的注释没有回答“为什么是 100、为什么打九折”
    price = price * 9 / 10;
}`,
          good: `int price = order.getPrice();
if (price > 100) {
    // 关键：写清楚“为什么”。100 是渠道促销的门槛，折扣比例由运营按季度调整
    price = applyChannelDiscount(price);
}`
        },
        principle: '好注释解释“为什么”，代码自己负责“是什么”。',
        related: ['career-clarify-requirements', 'java-swallow-exception']
      },
      {
        id: 'career-ds-in-practice',
        title: '数据结构只会背不会选',
        category: 'career',
        difficulty: '入门',
        tags: ['数据结构', '面试', '工程'],
        scenario: '日常写业务代码时选容器；或者面试前突击数据结构，背完就忘。',
        symptom: '面试时红黑树、B+ 树倒背如流，写代码时不管什么场景都用 ArrayList 和 HashMap。',
        cause: '日常业务开发里用得最多的是 HashMap（映射查找），其次是 ArrayList、HashSet（去重）。面试考的红黑树、B+ 树，价值在理解“为什么这么设计”，日常编码会用成熟容器就够了。',
        fix: [
          '日常编码会用成熟容器就够：映射用 HashMap，去重用 HashSet，按顺序放用 ArrayList。',
          '认识三个进阶结构：LinkedHashMap（实现 LRU）、优先队列 PriorityQueue（TopK 问题）、跳表（理解 Redis 有序集合）。',
          '把面试里的结构当成设计思路来理解：为什么这么设计，换一种会怎样。'
        ],
        example: {
          lang: 'java',
          bad: `// 想做一个“最多保留 100 个结果”的缓存，随手用了 HashMap
private final Map<String, Report> cache = new HashMap<>();

public void put(String key, Report report) {
    // 关键：HashMap 不会淘汰任何东西，条目只会越积越多
    cache.put(key, report);
}`,
          good: `// 关键：accessOrder 为 true 的 LinkedHashMap 按访问顺序排列，移除最旧的就是 LRU
private final Map<String, Report> cache = new LinkedHashMap<String, Report>(16, 0.75f, true) {
    @Override
    protected boolean removeEldestEntry(Map.Entry<String, Report> eldest) {
        return size() > 100;          // 超过 100 个就淘汰最久没被访问的那一个
    }
};`
        },
        principle: '日常会用成熟容器就够，面试里的结构价值在理解设计。',
        related: ['java-hashmap-concurrent', 'mysql-index-btree', 'ai-algorithm-basics']
      },
      {
        id: 'career-workflow-engine',
        title: '上来就自研工作流引擎',
        category: 'career',
        difficulty: '资深',
        tags: ['工作流', '引擎', '架构', '选型'],
        scenario: '业务提出审批、流转类的需求，团队准备自己写一个工作流引擎。',
        symptom: '做到一半发现会签、驳回、撤回每个都是坑，投入越来越多，最后没人敢改，烂尾在半路。',
        cause: '工作流的复杂度不在“状态会变”，而在会签、驳回、并行分支、可配置、可追溯这些需求上，每多一项，复杂度就上一个台阶。',
        fix: [
          '动手前先回答三个问题：流程是固定的还是需要运营可配、要不要会签驳回和并行分支、历史轨迹要不要可追溯。',
          '流程固定就用状态机，简单可靠；可配才考虑引擎。',
          '会签、驳回这类会推高复杂度的需求能砍就砍，砍之前先和业务确认。',
          '历史轨迹要可追溯的话，数据模型里的流转记录表是灵魂。',
          '轻量场景自研状态机，重场景直接上 Flowable 或 Camunda，别重复造轮子。'
        ],
        example: {
          lang: 'text',
          bad: `开工前：没有问流程是不是真的需要运营可配，直接按“通用引擎”立项
需求：“做一个审批流，以后各种流程都往上面放”
方案：自研引擎，支持任意节点、任意分支、可视化配置
做到一半：会签、驳回、撤回每加一个都要改数据模型
结果：没人敢动了，项目烂尾在半路`,
          good: `先回答三个问题，再决定做不做引擎：
一、流程是固定的，还是需要运营可配？
二、需要会签、驳回、并行分支吗？这些每多一项，复杂度就上一个台阶
三、历史轨迹要可追溯吗？要的话，流转记录表是数据模型的灵魂
回答“固定、不需要会签”：一张状态表加动作校验就够
回答“每周都要调、要会签”：直接上 Flowable 这类成熟引擎，不自研`
        },
        principle: '固定流程用状态机，可配才上引擎，中间态慎选。',
        related: ['career-approval-flow', 'career-architect-thinking', 'eng-idempotency']
      },
      {
        id: 'career-approval-flow',
        title: '审批流盲目上流程引擎',
        category: 'career',
        difficulty: '进阶',
        tags: ['审批流', '状态机', 'Flowable', '选型'],
        scenario: '做一个审批功能，在“自己写个状态机”和“引入流程引擎”之间选。',
        symptom: '流程简单的场景上了引擎，改一个节点要改流程定义、重新部署；该上引擎的场景硬写状态机，加一个会签就得改数据结构。',
        cause: '两条路的成本结构不一样：状态机便宜但不灵活，引擎灵活但门槛和运维成本高。中间那种“自己写个类引擎”的路线，两头的好处都没占到，最容易烂尾。',
        fix: [
          '流程简单且固定：用状态机，一张状态表加动作校验，几十行代码。',
          '涉及动态配置、会签、转办、撤回等运营诉求：用流程引擎（Flowable）。',
          '中间态慎选，自研“类引擎”是最容易烂尾的路线。',
          '动手前多问业务一句，未来一年审批流程会不会经常变，按变化频率来决策。'
        ],
        example: {
          lang: 'java',
          bad: `// 审批流程固定，却引入了流程引擎
// 关键：加一个审批人要改流程定义、重新部署，改一次发一次版
repositoryService.createDeployment().addClasspathResource("leave.bpmn20.xml").deploy();
runtimeService.startProcessInstanceByKey("leave", variables);
// 运营想临时加一个“部门负责人”节点，只能排期等开发`,
          good: `// 关键：流程固定，就用“当前状态 + 动作”的校验规则来表达，不引入引擎
public void apply(Long id, Action action) {
    Status status = mapper.statusOf(id);
    boolean allowed =
            (status == Status.DRAFT && action == Action.SUBMIT) ||
            (status == Status.PENDING && (action == Action.APPROVE || action == Action.REJECT));
    if (!allowed) throw new BizException("当前状态不允许该操作");
    mapper.updateStatus(id, action);
}`
        },
        principle: '按流程的变化频率决策：固定用状态机，常变才用引擎。',
        related: ['career-workflow-engine', 'eng-idempotency', 'career-automation-tooling']
      },
      {
        id: 'career-automation-tooling',
        title: '自动化工具跟着热点选',
        category: 'career',
        difficulty: '入门',
        tags: ['自动化', 'Make', 'Coze', '选型'],
        scenario: '要做一个自动化需求（抓数据、发报告，或者做一个问答机器人），在 Make、Coze、n8n 这些工具之间挑。',
        symptom: '看着别人用什么自己就用什么，做出来的东西和场景不匹配：要跑固定流程的做成了对话，要做对话的硬拿管道去拼。',
        cause: '先分清楚两者不是一类东西：Make 是“系统间连管道”，做 API 自动化，类似 Zapier、n8n；Coze 是“搭 AI 机器人”，是智能体平台，工作流只是它的一部分。',
        fix: [
          '先想清楚要自动化的是“流程”还是“对话”。',
          '要跑固定流程（抓数据、发报告）选 Make，这套思维可以迁移到 n8n。',
          '要做对话机器人、知识库问答选 Coze，中文生态友好。',
          '选工具之前先定场景，比选工具本身重要。'
        ],
        example: {
          lang: 'text',
          bad: `需求：每天早上把昨天的销售数据汇总成一封邮件发出去
判断：没有先想清楚它要自动化的是“流程”还是“对话”
选型：Coze，因为最近都在聊它
理由：新东西总比旧东西好
结果：选型理由和场景没有任何关系`,
          good: `需求：每天早上把昨天的销售数据汇总成一封邮件发出去
判断：这是“流程”，步骤固定、不需要对话
选型：Make（或 n8n），定时触发，拉取数据，汇总，发送邮件
另一个需求：内部规章的问答助手，这才是“对话”，选 Coze
原则：想清楚要自动化的是“流程”还是“对话”，比选工具本身重要`
        },
        principle: '先定要自动化的是“流程”还是“对话”，再选工具。',
        related: ['ai-rpa-vs-agent', 'eng-rpa-selector', 'career-approval-flow']
      },
      {
        id: 'career-redirect-301-302',
        title: '改版时该用 301 的地方用了 302',
        category: 'career',
        difficulty: '入门',
        tags: ['HTTP', '重定向', '测试', 'SEO'],
        scenario: '网站改版、换域名，或者接口地址调整，需要把旧地址跳转到新地址。',
        symptom: '用户能跳过去，但搜索引擎一直不把新地址当作正式地址，旧地址的权重传不过去。',
        cause: '301 是永久重定向，浏览器和搜索引擎会记住新地址，之后直接访问新地址；302 是临时重定向，每次都先访问旧地址再跳转。该永久的地方用了 302，搜索引擎就一直认为旧地址才是正式的。',
        fix: [
          '永久迁移用 301，临时跳转用 302。',
          '测试时确认：301 之后旧地址不再直接提供内容，而是跳转到新地址，新地址可以直接访问。',
          '302 要验证跳转目标是否正确。',
          '改版、换域名这类场景，检查有没有该用 301 却写成了 302 的地方。'
        ],
        example: {
          lang: 'shell',
          bad: `# 站点改版：旧地址永久搬到新地址，返回的却是 302（临时跳转）
curl -I http://shop.internal/old-help
# HTTP/1.1 302 Found
# Location: http://shop.internal/help/new
# 关键：搜索引擎会把旧地址继续当作正式地址，新地址的权重一直起不来`,
          good: `# 关键：永久迁移返回 301，浏览器和搜索引擎会把新地址记下来
curl -I http://shop.internal/old-help
# HTTP/1.1 301 Moved Permanently
# Location: http://shop.internal/help/new
# 测试时确认：旧地址仍然返回 301（而不是 404），新地址可以直接访问`
        },
        principle: '永久用 301，临时用 302，选错了搜索引擎不认新地址。',
        related: ['eng-no-rollback-plan', 'eng-happy-path-testing']
      },
      {
        id: 'career-learning-spring',
        title: '只看视频学框架',
        category: 'career',
        difficulty: '入门',
        tags: ['学习', 'Spring', '方法'],
        scenario: '自学 Spring 全家桶，纠结是看视频、读文档，还是直接做项目。',
        symptom: '视频看了不少，跟着敲也能跑，合上视频自己从头搭一个就无从下手；或者一上来就啃文档，在细节里迷路。',
        cause: '三种材料各管一段：视频帮你快速建立全局认知，文档才是准确的细节，项目用来把知识变成能用的东西。只靠其中一种，就会停在“看会了”的错觉里。',
        fix: [
          '入门看视频，快速建立全局认知。',
          '进阶读官方文档，从入门指南一直读到源码。',
          '实战做项目，在 GitHub 上找一个真实场景练手。',
          '三个阶段别颠倒。',
          '检验标准：能不能给别人讲清楚 Spring 的 IOC 和 AOP 解决了什么问题。'
        ],
        principle: '视频建全局，文档补细节，项目见真章。',
        related: ['career-depth-first', 'spring-new-dependencies', 'career-clarify-requirements']
      },
      {
        id: 'career-ai-vs-coder',
        title: '把写代码等同于程序员的全部产出',
        category: 'career',
        difficulty: '进阶',
        tags: ['AI', '职业', '趋势'],
        scenario: '看到画师被 AI 大量替代，担心程序员是下一个。',
        symptom: '要么高估风险，早早转行；要么高枕无忧，继续只做“把需求翻译成代码”的活。',
        cause: '两者的产出不一样：画师交付的是最终交付物（图），AI 可以直接生成它；程序员交付的是运行中的系统，代码只是中间产物。需求澄清、架构取舍、线上排障、业务对齐这些占大头的工作，AI 短期覆盖不了。',
        fix: [
          '认清差异：程序员的价值在“运行中的系统”，不只是代码。',
          '也别高枕无忧：AI 正在重置行业对“初级纯编码”的需求结构，向上走是唯一的路。',
          '把精力从写代码本身，挪到需求澄清、架构取舍和线上排障上。'
        ],
        principle: '程序员交付的是运行中的系统，代码只是中间产物。',
        related: ['ai-replacement-anxiety', 'career-architect-thinking', 'ai-keep-learning-java']
      },
      {
        id: 'career-debug-mindset',
        title: '遇到问题不复现、不记录就下结论',
        category: 'career',
        difficulty: '入门',
        tags: ['调试', '思维', '方法'],
        scenario: '排查一个偶现的 bug，或者面对工作里一个说不清的问题，凭感觉就开始改。',
        symptom: '改了半天问题还在，甚至越改越乱；回过头说不清问题到底是什么时候、什么条件下出现的。',
        cause: '没有先把问题“钉住”就动手：不确定怎么复现、不缩小范围、手里没有数据，只剩下猜测。调试的价值在于一套把未知一点点变小的流程。',
        fix: [
          '复现：搞清楚问题什么时候出现，别凭感觉。',
          '二分定位：缩小范围，先判断是能力问题还是方向问题。',
          '看日志：记录数据，而不是靠记忆。',
          '最小化验证：一次只改一个变量，看结果。',
          '这套流程套到别的问题上，同样好用。'
        ],
        example: {
          lang: 'text',
          bad: `现象：测试环境偶尔下单失败
处理：“应该是网络问题吧”，改了一处超时时间，提交，让测试再试试
第二天：还是偶现。再改一处别的地方
追问：它什么时候出现？出现的时候请求长什么样？没人说得清
结果：改了好几处，问题还在，每处改动带来了新的不确定`,
          good: `现象：测试环境偶尔下单失败
复现：按 traceId 搜出失败那几次请求的日志，发现都发生在库存服务重启之后的短时间内
二分：只在“库存服务刚启动”时出现，范围缩小到启动阶段的连接池预热
看数据：对比正常和失败两种情况下，库存服务返回的耗时
最小验证：本地重启库存服务的同时发请求，稳定复现；只改“预热完成后再接流量”这一处`
        },
        principle: '先复现、再二分、看数据、一次只改一个变量。',
        related: ['eng-request-trace', 'java-swallow-exception', 'career-clarify-requirements']
      },
      {
        id: 'career-clarify-requirements',
        title: '需求没弄清就开写',
        category: 'career',
        difficulty: '入门',
        tags: ['需求', '沟通', '验收标准'],
        scenario: '接到一段需求描述，大致看懂了就开始写代码，没有和提需求的人确认细节。',
        symptom: '做到一半甚至做完了，才发现理解偏了：口径不对、场景漏了，返工的成本比从头做还高。',
        cause: '需求描述里没写出来的东西，双方各自脑补了一版，而代码只按程序员的那一版写。偏差发现得越晚，改起来的代价越大。',
        fix: [
          '动手前把验收标准写出来：做完之后，在什么输入下应该得到什么结果。',
          '把边界和例外问清楚：数据为空、数量为零、用户取消的时候怎么办。',
          '和提需求的人当面或书面确认一遍，再开始写。',
          '需求有歧义时，先做一个最小的版本给对方看，早对齐、早纠偏。'
        ],
        example: {
          lang: 'text',
          bad: `需求：“给订单列表加一个导出功能”
理解：导出列表页上显示的这些字段，做成 Excel 就行
动手：直接开始写
提测时：“怎么没有金额列？还要能按仓库分别导出。另外金额要含税的。”
结果：返工的范围比从头做一遍还大`,
          good: `需求：“给订单列表加一个导出功能”
动手前先把验收标准写出来，发给提需求的人确认：
1. 导出当前筛选条件下的全部订单，不只是当前页
2. 字段：订单号、下单时间、客户、仓库、含税金额、状态
3. 数据量大时改为后台生成，完成后通知下载
4. 没有订单时给出“暂无可导出的数据”，而不是一个空文件
确认无误之后再开始写`
        },
        principle: '动手前把验收标准写出来，和提需求的人确认。',
        related: ['ai-non-dev-build-product', 'eng-happy-path-testing', 'career-useful-comments']
      }
    ]
  };
});
